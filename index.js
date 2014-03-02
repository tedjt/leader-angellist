var debug = require('debug')('leader:angelist');
var extend = require('extend');
var objCase = require('obj-case');
var flatnest = require('flatnest');
var Levenshtein = require('levenshtein');
var Angel = require('angel.co');

/**
 * Create a new leader plugin.
 *
 * @params {String} apiKey
 * @returns {Object}
 */

module.exports = function (options) {
  return { fn: middleware(options), wait: wait};
};

module.exports.test = {
  validateName: validateName
};

/**
 * Create a Fullcontact name API leader plugin.
 *
 * @return {String} apiKey
 * @return {Function}
 */

function middleware (options) {
  var angel = new Angel(options.clientId, options.token);
  return function fullcontactPersonApi (person, context, next) {
    var query = getSearchTerm(person, context);
    if (!query) return next();
    debug('query angellist with query %s ..', query);
    angel.search.search({
      query: query,
      type: 'Startup'
    }, function(err, body) {
      if (err) return next(err);
      var body = parseJson(body);
      if (body instanceof Error) return next(err);
      if (body.length < 1) {
        debug('no results found for %s', query);
        return next();
      }
      var id = body[0].id;
      angel.startups.get(body[0].id, function(err, body) {
        if (err) return next(err);
        var body = parseJson(body);
        if (body instanceof Error) return next(err);
        if (validateName(body, query)) {
          extend(true, context, { angelist: { company: { api : body }}});
          details(body, person);
          debug('Got Angellist company profile for query %s', query);
        } else {
          debug('Skipping Angellist company profile for query %s with name: %s', query, body.name);
        }
        next();
      });
    });
  };
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch(e) {
    return e;
  }
}

function validateName(data, query) {
  var name = data.name;
  if (name) {
    var lev = new Levenshtein(name, query);
    if (lev.distance < 10) {
      return true;
    }
  }
  return false;
}

/**
 * Copy the angellist company `profile` details to the `person.company`.
 *
 * @param {Object} profile
 * @param {Object} person
 */

function details (profile, person) {
  person.company = person.company || {};
  extend(true, person.company, remap(profile, {
    'name': 'name',
    'image_url': 'logo_url',
    'description': 'product_desc',
    'concept': 'high_concept',
    'angellist.followers': 'follower_count',
    'angellist.url': 'angellist_url',
    'website': 'company_url',
    'crunchbase.url': 'crunchbase_url',
    'twitter.url': 'twitter_url',
    'blog_url': 'blog_url',
    'location': 'locations[0].display_name'
  }));

  if (profile.markets) {
    person.company.tags = profile.markets.map(function(m) {
      return m.display_name;
    }).join(', ');
  }
}

function remap(obj, keysObj) {
  var r = {};
  Object.keys(keysObj).forEach(function(k) {
    var v = objCase(obj, keysObj[k]);
    if (v) {
      flatnest.replace(r, k, v, true);
    }
  });
  return r;
}

/**
 * Wait until we have an interesting search term.
 *
 * @param {Object} context
 * @param {Object} person
 * @return {Boolean}
 */

function wait (person, context) {
  return getSearchTerm(person, context);
}

/**
 * Get the Angellist search term.
 *
 * @param {Object} person
 * @param {Object} context
 * @return {String}
 */

function getSearchTerm (person, context) {
  var company = getCompanyName(person, context);
  var domain = getInterestingDomain(person, context);
  return company || domain;
}

/**
 * Get the company name.
 *
 * @param {Object} context
 * @param {Object} person
 * @return {String}
 */

function getCompanyName (person, context) {
  return objCase(person, 'company.name');
}

/**
 * Get an interesting domain.
 *
 * @param {Object} context
 * @param {Object} person
 * @return {String}
 */

function getInterestingDomain (person, context) {
  if (person.domain && !person.domain.disposable && !person.domain.personal)
    return person.domain.name;
  else
    return null;
}
