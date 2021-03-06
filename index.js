var debug = require('debug')('leader:angelList');
var extend = require('extend');
var defaults = require('defaults');
var leaderUtils = require('leader-utils');
var objCase = leaderUtils.objcase;
var flatnest = require('flatnest');
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
  var credentialIndex = 0;
  var credentials;
  if (options.credentials) {
    credentials = options.credentials[0];
  } else if (options.clientId && options.token) {
    credentials = options;
  }
  var angel = credentials ? new Angel(credentials.clientId, credentials.token) : new Angel();
  return function angelList (person, context, next) {
    var query = getSearchTerm(person, context);
    if (!query) return next();
    debug('query angelList with query %s ..', query);
    var attempts = 0;
    var attemptFn = function() {
      tryAngellist(options, angel, query, person, context, function(err, rateLimited) {
        if (rateLimited && options.credentials && attempts < options.credentials.length - 1) {
          debug('Angelist returned error for query %s ..', query);
          attempts ++;
          // bump credeti
          credentialIndex++;
          credentials = options.credentials[credentialIndex % options.credentials.length];
          angel = new Angel(credentials.clientId, credentials.token);
          // only retry if we are sure its a rate limit
          if (rateLimited.error === 'over_limit') {
            debug('retrying angelList with query %s ..', query);
            return attemptFn();
          } else {
            return next(err);
          }
        } else {
          return next(err);
        }
      });
    };
    // first attempt
    attemptFn();
  };
}

function tryAngellist(options, angel, query, person, context, next) {
  angel.search.search({
    query: query,
    type: 'Startup'
  }, function(err, resBody) {
    if (err) return next(err);
    var body = parseJson(resBody);
    if (body instanceof Error) return next(err);
    if (!body) {
      debug('no results found for %s', query);
      return next();
    }
    if (body.error) {
      debug('error received %j', body);
      return next(null, body);
    }
    if (body.length < 1) {
      debug('no results found for %s', query);
      return next();
    }
    var id = body[0].id;
    angel.startups.get(body[0].id, function(err, body) {
      if (err) return next(err);
      var companyBody = parseJson(body);
      if (companyBody instanceof Error) return next(err);
      var isDomain = (query === getDomainQuery(person));
      if (validateName(companyBody, query, isDomain)) {
        extend(true, context, { angelList: { company: { api : companyBody }}});
        details(companyBody, person);
        debug('Got angelList company profile for query %s', query);
        var angelListUrl = objCase(person, 'company.angelList.url');
        if (angelListUrl) {
          scrapeCompany(angelListUrl, options.headers, function(error, funding) {
            if (error) return next(error);
            if (!funding) return next();
            extend(true, context, { angelList: { company: { scrape : funding }}});
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
    if (response.statusCode != 200) return cb(new Error('AngelList bad status code ' + response.statusCode));
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

function validateName(data, query, isDomain) {
  if (isDomain && data.company_url) {
    // require domain to be the same...
    return leaderUtils.getCleanDomain(data.company_url) === query;
  } else {
    return data.name && leaderUtils.accurateTitle(data.name, query);
  }
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
  var company = leaderUtils.getCompanyName(person);
  var domain = leaderUtils.getInterestingDomain(person);
  var companyDomain = leaderUtils.getCompanyDomain(person);
  return companyDomain || domain || company;
}

function getDomainQuery (person) {
  var domain = leaderUtils.getInterestingDomain(person);
  var companyDomain = leaderUtils.getCompanyDomain(person);
  return companyDomain || domain;
}
