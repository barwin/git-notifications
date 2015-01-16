var ASQ = require('asynquence'),
    config = require('config'),
    debug = require('debug')('gitnotifier:git_poller'),
    path = require('path'),
    _ = require('underscore');

var GitNotifier = require('./lib/gitNotifier'),
    gitNotifier = new GitNotifier();


_.each(config.get('repoList'), function(repo) {
    var repoUrl = repo.gitUrl;
    debug(repoUrl + " => " + path.basename(repoUrl));

    ASQ(repoUrl).
        then(function(done, repoUrl) {
            // Check that repo is checked out in our 'jail'
            gitNotifier.cloneRepoIfNotExists(repoUrl, function(err) {
                if (err) {
                    console.error("Failed to clone repo: " + repoUrl + ":", err);
                    done.fail(err);
                }
                else {
                    done();
                }
            });
        })
        .then(function(done) {
            gitNotifier.checkForNewCommits(repoUrl, function(err, ansiLogAndDiff, remoteSha1) {
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
            gitNotifier.sendEmailNotification(repoUrl, ansiLogAndDiff, remoteSha1, function(err, info) {
                if (err) {
                    console.error("Failed to send email:", err);
                    done.fail(err);
                }
                else {
                    debug("Email sent: " + info.response);
                    done();
                }
            });
        })
        .or(function(err) {
            console.error("Bailing out on repo %s:", repoUrl, err);
            throw err;
        });
});