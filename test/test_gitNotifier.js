require('should');

var assert = require('assert'),
    fs = require('fs'),
    temp = require('temp');

// Automatically track and cleanup files at exit
temp.track();

describe('lib/gitNotifier', function() {
    var GitNotifier = require('../lib/gitNotifier'),
        gitNotifier;

    before(function(done) {

        gitNotifier = new GitNotifier();

        temp.mkdir('test_repo_jail', function(err, tmpDirPath) {
            console.log("Created temp dir '%s'", tmpDirPath);

            gitNotifier.REPO_JAIL = tmpDirPath;

            done();
        });
    });

    describe('cloneRepoIfNotExists', function() {

        it('should clone repo into REPO_JAIL dir', function(done) {
            assert(gitNotifier, 'gitNotifier should have been instantiated by now');

            gitNotifier.cloneRepoIfNotExists('https://github.com/barwin/git-notifications.git', function(err) {
                assert.ifError(err);
                fs.exists(gitNotifier.REPO_JAIL + '/git-notifications.git', function(exists) {
                    exists.should.equal(true);
                    done();
                });
            })
        });

    });

    describe.skip('checkForNewCommits', function() {

    });

    describe.skip('sendEmailNotification', function() {

    });
});