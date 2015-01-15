require('should');

var assert = require('assert'),
    ASQ = require('asynquence'),
    fs = require('fs'),
    Git = require('../lib/git-wrapper-local'),
    temp = require('temp');

// Automatically track and cleanup files at exit
temp.track();

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
            gitNotifier.checkForNewCommits(tmpRepoOriginPath, function(err, diff, latestSha1) {
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
            gitNotifier.checkForNewCommits(tmpRepoOriginPath, function(err, diff, latestSha1) {
                assert.ifError(err);
                diff.should.be.type('string');
                latestSha1.should.be.type('string');
                done();
            });
        });

    });

    describe.skip('sendEmailNotification', function() {

    });
});