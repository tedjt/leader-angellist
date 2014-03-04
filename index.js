var debug = require('debug')('leader:angelist');
var extend = require('extend');
var defaults = require('defaults');
var objCase = require('obj-case');
var flatnest = require('flatnest');
var Levenshtein = require('levenshtein');
var request = require('request');
var cheerio = require('cheerio');
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
  validateName: validateName,
  scrapeCompany: scrapeCompany
};

/**
 * Create a AngelList leader plugin.
 *
 * @return {String} apiKey
 * @return {Function}
 */

function middleware (options) {
  options = options || {};
  var angel = new Angel(options.clientId, options.token);
  return function angelList (person, context, next) {
    var query = getSearchTerm(person, context);
    if (!query) return next();
    debug('query angelList with query %s ..', query);
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
        var companyBody = parseJson(body);
        if (companyBody instanceof Error) return next(err);
        if (validateName(companyBody, query)) {
          extend(true, context, { angelist: { company: { api : companyBody }}});
          details(companyBody, person);
          debug('Got angelList company profile for query %s', query);
          var angelListUrl = objCase(person, 'company.angelList.url');
          if (angelListUrl) {
            scrapeCompany(angelListUrl, options.headers, function(error, funding) {
              if (error) return next(error);
              if (!funding) return next();
              extend(true, context, { angelist: { company: { scrape : funding }}});
              if (funding.total) person.company.funding = funding.total;
              if (funding.rounds) person.company.angelList.funding_rounds = funding.rounds;
              return next();
            });
          } else {
            return next();
          }
        } else {
          debug('Skipping angelList company profile for query %s with name: %s', query, body.name);
          next();
        }
      });
    });
  };
}

function scrapeCompany(url, headers, cb) {
  headers =  defaults(headers || {}, { // disguise headers
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/28.0.1500.71 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language' :'en-US,en;q=0.8',
    'Cache-Control'   :'max-age=0'
  });
  var req = { url: url, headers: headers };
  request(req, function (error, response, body) {
    if (error) return cb(error);
    if (!response) return cb(new Error('No response received'));
    if (response.statusCode != 200) return cb(new Error('bad status code %d', response.statusCode));
    $ = cheerio.load(body);
    var funding = [];
    $('.startup_round').each(function(i, e) {
      funding.push({
        type: $(e).find('.type').text().trim(),
        amount: $(e).find('.raised').text().trim()
      });
    });
    if (funding.length) {
      var totalFunding = funding.reduce(function(p, c, i, arr) {
        return p + parseInt(c.amount.replace(/[$,]/g, ''), 10);
      }, 0);
      return cb(null, {
        total: totalFunding,
        rounds: funding
      });
    } else {
      return cb(null, null);
    }
  });
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
 * Copy the angelList company `profile` details to the `person.company`.
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
    'angelList.followers': 'follower_count',
    'angelList.url': 'angellist_url',
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
 * Get the angelList search term.
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
