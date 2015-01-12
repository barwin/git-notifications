var ASQ = require('asynquence'),
    async = require('async'),
    config = require('config'),
    Convert = require('ansi-to-html'),
    convert = new Convert(),
    fs = require('fs'),
    Email = require('email').Email,
    Git = require('git-wrapper'),
    path = require('path'),
    _ = require('underscore');

// Local path where we will clone and track repos.
var REPO_JAIL = __dirname + '/var',
    EMAIL_TO = config.get('email.to'),
    EMAIL_FROM = config.get('email.from');


_.each(config.get('repoList'), function(repo) {
    var repoUrl = repo.gitUrl;
    console.log(repoUrl + " => ", path.basename(repoUrl));

    ASQ(repoUrl).
        then(function(done, repoUrl) {
            // Check that repo is checked out in our 'jail'
            cloneRepoIfNotExists(repoUrl, function(err) {
                if (err) { done.fail(err); }
                else {
                    done();
                }
            });
        })
        .then(function(done) {
            checkForNewCommits(repoUrl, function(err, ansiLogAndDiff, remoteSha1) {
                if (err) { done.fail(err); }
                else {
                    if (ansiLogAndDiff) {
                        done(ansiLogAndDiff, remoteSha1);
                    }
                    else {
                        // Nothing left to do if there is no diff.
                        done.abort();
                    }
                }
            });
        })
        .then(function(done, ansiLogAndDiff, remoteSha1) {
            sendEmailNotification(repoUrl, ansiLogAndDiff, remoteSha1, function(err) {
                if (err) {
                    console.error("Failed to send email:", err);
                    done.fail(err);
                }
                else {
                    done();
                }
            });
        })
        .or(function(err) {
            console.error("Bailing out on repo %s:", repoUrl, err);
        });
});


/**
 * Clone repo if it's not already cloned.
 *
 * New repo clone will be a shallow bare clone.
 *
 * @param {string} repoUrl
 * @param {function} callback
 */
function cloneRepoIfNotExists(repoUrl, callback) {
    var localRepoPath = localPath(repoUrl);

    fs.exists(localRepoPath, function(exists) {
        if (!exists) {
            console.log("Repo " + repoUrl + " does not exist locally yet. Cloning to " + localRepoPath);
            new Git().exec('clone', { bare: true, depth: 1 }, [ repoUrl, localRepoPath ], function(err, msg) {
                if (err) {
                    console.error("Failed to clone repo: " + repoUrl + ":", err);
                    doCallback(callback, [err]);
                }
                else {
                    console.log("Successfully cloned repo: %s", localRepoPath, msg);
                }
            });
        }
        else {
            console.log("Repo already exists: " + localRepoPath);
        }

        doCallback(callback);
    });
}

/**
 * Fetches new commits from origin, and returns the diff.
 *
 * @param {string} repoUrl
 * @param {function} callback (err, diff)
 */
function checkForNewCommits(repoUrl, callback) {

    var localRepoPath = localPath(repoUrl),
        git = new Git({ 'git-dir': localRepoPath });

    ASQ()
        .then(function(done) {
            // get latest LOCAL sha1
            git.exec('rev-parse', {}, ['HEAD'], function(err, localSha1) {
                if (err) { done.fail(err); }
                else {
                    done(localSha1.trim());
                }
            });
        })
        .then(function(done, localSha1) {
            // get latest REMOTE sha1
            git.exec('ls-remote', {}, [ 'origin', 'HEAD' ], function(err, remoteSha1Line) {
                if (err) { done.fail(err); }
                else {
                    var remoteSha1 = remoteSha1Line.split(/\s/)[0];
                    done(localSha1, remoteSha1);
                }
            })
        })
        .then(function(done, localSha1, remoteSha1) {
            if (localSha1 === remoteSha1) {
                // no new commits
                console.log("no new commits");
                done();
            }
            else {
                // We have new commits!
                console.log("There are new commits!");
                // Fetch, log, and diff
                git.exec('fetch', {}, [ 'origin', 'master:master' ], function(err) {
                    if (err) { done.fail(err); }
                    else {
                        // Git 'log' and 'diff' take [mostly] the same flags/args.
                        // So define here for convenience.
                        var gitOpts = { color: true, paginate: false},
                            gitArgs = [ localSha1+".."+remoteSha1 ];

                        async.parallel([
                            function(cb) {
                                git.exec('log', _.extend(_.clone(gitOpts), { stat: true }), gitArgs, cb);
                            },
                            function(cb) {
                                git.exec('diff', gitOpts, gitArgs, cb);
                            }
                        ],
                        function(err, results) {
                            var ansiLog = results[0],
                                ansiDiff = results[1];

                            if (err) { done.fail(err); }
                            else {
                                done(ansiLog + "\n\n" + ansiDiff, remoteSha1);
                            }
                        });
                    }
                });
            }
        })
        .val(function(ansiLogAndDiff, remoteSha1) {
            doCallback(callback, [null, ansiLogAndDiff, remoteSha1]);
        })
        .or(function(err) {
            doCallback(callback, [err]);
        });
}


/**
 * Fire off the email containing our git diff
 *
 * @param {string} repoUrl
 * @param {string} ansiLogAndDiff
 * @param {string} remoteSha1
 * @param {function} callback
 */
function sendEmailNotification(repoUrl, ansiLogAndDiff, remoteSha1, callback) {
    // ansi-to-html doesn't include line breaks, so we must add those ourselves.
    var htmlBody = convert.toHtml(ansiLogAndDiff).replace(/\n/g, '\n<br>');

    // Send email!
    console.log("Sending email from=%s to=%s", EMAIL_FROM, EMAIL_TO);
    var msg = new Email({
        from: EMAIL_FROM,
        to: EMAIL_TO,
        subject: "[Git] new commits in " + path.basename(repoUrl) + " " + remoteSha1.substring(0,8),
        body: htmlBody,
        bodyType: 'html'
    });

    msg.send(callback);
}


function localPath(repoUrl) {
    return REPO_JAIL + '/' + path.basename(repoUrl);
}

/**
 * Wrapper for conditionally calling a callback.
 *
 * @param {function} cb
 * @param {Array} args Optional arguments to the callback
 */
function doCallback(cb, args) {
    if (cb) {
        cb.apply(null, args);
    }
}