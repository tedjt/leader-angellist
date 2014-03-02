
var assert = require('assert');
var should = require('should');
var plugin = require('..');

describe('leader-angelist', function () {
  var angelist = plugin({
    clientId: 'c4a625064f87a49b248aeb9fb0b56455',
    token: 'd8f1948777cd42b8e2cafd8af38acf1e'
  });

  it('should wait if theres no company name', function () {
    var context = {}, person = {};
    assert(!angelist.wait(person, context));
  });

  it('should not wait if there is a company name', function () {
    var person = { company: { name: 'segment.io'}};
    var context = {};
    assert(angelist.wait(person, context));
  });

  it('should merge profile if the name is similar', function () {
    var profile = {name: 'Machine Zone, Inc.'};
    assert(plugin.test.validateName(profile, 'MachineZone'));
  });

  it('should not merge profile if the name is not similar', function () {
    var profile = {name: 'Homes for sale in Franklin TN'};
    assert(!plugin.test.validateName(profile, 'Premier Pacific Group'));
  });

  it('should be able to resolve a valid angelist company profile', function (done) {
    var person = { company: { name: 'segment.io'}};
    var context = {};
    angelist.fn(person, context, function (err) {
      if (err) return done(err);
      assert(person);
      assert(person.company.angellist.url === 'https://angel.co/segment-io');
      assert(person.company.image_url == 'https://s3.amazonaws.com/photos.angel.co/startups/i/58552-2cc6e15adb363655fe89736fe5f37c14-medium_jpg.jpg?buster=1333485923');
      done();
    });
  });
});