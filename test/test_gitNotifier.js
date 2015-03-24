require('should');

var assert = require('assert'),
    ASQ = require('asynquence'),
    fs = require('fs'),
    Git = require('../lib/git-wrapper-local'),
    temp = require('temp');

// Automatically track and cleanup files at exit
temp.track();

// Set NODE_ENV so that config/local-testing.js is loaded.
if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'testing';
}

describe('lib/gitNotifier', function() {
    var GitNotifier = require('../lib/gitNotifier'),
        gitNotifier;

    before(function(done) {
        gitNotifier = new GitNotifier();

        temp.mkdir('test_repo_jail', function(err, tmpDirPath) {
            gitNotifier.REPO_JAIL = tmpDirPath;
            done();
        });
    });

    describe('cloneRepoIfNotExists', function() {

        it('should clone repo into REPO_JAIL dir', function(done) {
            gitNotifier.cloneRepoIfNotExists('https://github.com/barwin/git-notifications.git', function(err) {
                assert.ifError(err);
                fs.exists(gitNotifier.REPO_JAIL + '/git-notifications.git', function(exists) {
                    exists.should.equal(true);
                    done();
                });
            });
        });

        it('should throw an error when the repo does not exist', function(done) {
            gitNotifier.cloneRepoIfNotExists('file:///noexist', function(err) {
                err.should.be.instanceof(Error);

                fs.exists(gitNotifier.REPO_JAIL + '/noexist', function(exists) {
                    exists.should.equal(false);
                    done();
                });
            });
        });

    });

    describe('checkForNewCommits', function() {

        var tmpRepoOriginPath,
            tmpRepoName = 'testRepo',
            git;

        /**
         * Initialize a local repo with a single commit.
         */
        before(function(done) {
            temp.mkdir('test_checkForNewCommits', function(err, tmpDirPath) {
                tmpRepoOriginPath = tmpDirPath + '/' + tmpRepoName;
                fs.mkdirSync(tmpRepoOriginPath);
                git = new Git({ 'git-dir': tmpRepoOriginPath + '/.git', cwd: tmpRepoOriginPath });

                ASQ()
                    .then(function(next) {
                        new Git().exec('init', {}, [ tmpRepoOriginPath ], function(err) {
                            if (err) {
                                console.error("Error during git init");
                                return next.fail(err);
                            }
                            next();
                        });
                    })
                    .then(function(next) {
                        // Repo is init'd, do an initial commit.
                        fs.writeFileSync(tmpRepoOriginPath+'/test.txt', 'Hello World');

                        git.exec('add', {}, [ 'test.txt' ], function(err) {
                            if (err) {
                                console.error("Error during git add");
                                return next.fail(err);
                            }
                            next();
                        });
                    })
                    .then(function(next) {
                        git.exec('commit', { 'm': "'First commit'" }, [], function(err) {
                            if (err) {
                                console.error("Error during git commit");
                                return next.fail(err);
                            }
                            next();
                        });
                    })
                    .val(function() {
                        done(); // concludes before()
                    })
                    .or(function(err) {
                        console.error("Error during git commands: " + err);
                        throw err;
                    });
            });
        });

        it('should clone local temp repo without error', function(done) {
            gitNotifier.cloneRepoIfNotExists(tmpRepoOriginPath, function (err) {
                assert.ifError(err);
                fs.exists(gitNotifier.REPO_JAIL + '/' + tmpRepoName, function (exists) {
                    exists.should.equal(true);
                    done();
                });
            });
        });

        it('should not find new commits with an initial clone repo', function(done) {
            gitNotifier.checkForNewCommits(tmpRepoOriginPath, function(err, diff, localSha1, latestSha1) {
                assert.ifError(err);
                assert.equal(diff, undefined, 'Diff should be undefined');
                assert.equal(latestSha1, undefined, 'LatestSha1 should be undefined');
                done();
            });
        });

        it('add a test commit to the test repo', function(done) {
            fs.writeFileSync(tmpRepoOriginPath + "/newfile", 'a new file!');
            git.exec('add', {}, [ 'newfile' ], function(err) {
                assert.ifError(err);
                git.exec('commit', { m: "'Second Commit'" }, [], function(err) {
                    assert.ifError(err);
                    done();
                });
            });
        });

        it('should find new commits', function(done) {
            gitNotifier.checkForNewCommits(tmpRepoOriginPath, function(err, diff, localSha1, latestSha1) {
                assert.ifError(err);
                diff.should.be.type('string');
                latestSha1.should.be.type('string');
                done();
            });
        });

    });

    describe('isGitHubRepo', function() {
        it('should return true for github repos', function() {
            [
                'https://github.com/barwin/git-notifications.git',
                'https://github.com/barwin/git-notifications',
                'git@github.com:barwin/git-notifications.git'
            ]
                .forEach(function(repoUrl) {
                    assert.ok(gitNotifier.isGitHubRepo(repoUrl), 'true for github repo: ' + repoUrl);
                });
        });

        it('should return false for non-github repos', function() {
            [
                'file:///Users/barwin/sites/test_repo',
                'git@bitbucket.org:testuser/test_repo.git',
                'https://testuser@bitbucket.org/testuser/notify_bot.git'
            ]
                .forEach(function(repoUrl) {
                    assert.equal(gitNotifier.isGitHubRepo(repoUrl), false, 'false for non-github repo: ' + repoUrl);
                });
        });
    });

    describe('getGitHubWebDiffUrl', function() {

        var expectedCompareUrl = 'https://github.com/barwin/git-notifications/compare/foo...bar';

        it('should get urls for ssh repoUrls', function() {
            assert.equal(
                gitNotifier.getGitHubWebDiffUrl('git@github.com:barwin/git-notifications.git', 'foo', 'bar'),
                expectedCompareUrl
            )
        });

        it('should get urls for https repoUrls with .git extension', function() {
            assert.equal(
                gitNotifier.getGitHubWebDiffUrl('https://github.com/barwin/git-notifications.git', 'foo', 'bar'),
                expectedCompareUrl
            )
        });

        it('should get urls for https repoUrls without .git extension', function() {
            assert.equal(
                gitNotifier.getGitHubWebDiffUrl('https://github.com/barwin/git-notifications', 'foo', 'bar'),
                expectedCompareUrl
            )
        });
    });

    describe.skip('sendEmailNotification', function() {

    });
});
