var ASQ = require('asynquence'),
    assert = require('assert'),
    async = require('async'),
    config = require('config'),
    Convert = require('ansi-to-html'),
    convert = new Convert(),
    debug = require('debug')('gitnotifier:gitNotifier'),
    fs = require('fs'),
    Entities = require('html-entities').XmlEntities,
    entities = new Entities(),
    nodemailer = require('nodemailer'),
    Git = require('./git-wrapper-local'),
    path = require('path'),
    _ = require('underscore');


module.exports = GitNotifier;

/**
 *
 * @constructor
 */
function GitNotifier() {
    // Local path where we will clone and track repos.
    this.REPO_JAIL = __dirname + '/../var';

    debug("Checking if %s exists", this.REPO_JAIL);
    if (!fs.existsSync(this.REPO_JAIL)) {
        debug("Creating repo jail directory: " + this.REPO_JAIL);
        fs.mkdirSync(this.REPO_JAIL);
    }

    this.mailTransporter = undefined;
}

/**
 * Clone repo if it's not already cloned.
 *
 * New repo clone will be a shallow bare clone.
 *
 * @param {string} repoUrl
 * @param {function} callback
 */
GitNotifier.prototype.cloneRepoIfNotExists = function (repoUrl, callback) {
    var localRepoPath = this.localPath(repoUrl);

    fs.exists(localRepoPath, function(exists) {
        if (!exists) {
            debug("Repo " + repoUrl + " does not exist locally yet. Cloning to " + localRepoPath);
            new Git().exec('clone', { bare: true, depth: 1 }, [ repoUrl, localRepoPath ], function(err) {
                if (!err) {
                    debug("Successfully cloned repo: %s", path.basename(repoUrl));
                }
                doCallback(callback, [err]);
            });
        }
        else {
            doCallback(callback);
        }
    });
};

/**
 * Fetches new commits from origin, and returns the diff.
 *
 * @param {string} repoUrl
 * @param {function} callback (err, diff, latestSha1)
 */
GitNotifier.prototype.checkForNewCommits = function (repoUrl, callback) {

    var localRepoPath = this.localPath(repoUrl),
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
            });
        })
        .then(function(done, localSha1, remoteSha1) {
            if (localSha1 === remoteSha1) {
                // no new commits
                debug("No new commits found for " + path.basename(repoUrl));
                done();
            }
            else {
                // We have new commits!
                debug("There are new commits in repo '%s' %s..%s!", path.basename(repoUrl), localSha1, remoteSha1);
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
};


/**
 * Fire off the email containing our git diff
 *
 * @param {string} repoUrl
 * @param {string} ansiLogAndDiff
 * @param {string} remoteSha1
 * @param {function} callback
 */
GitNotifier.prototype.sendEmailNotification = function (repoUrl, ansiLogAndDiff, remoteSha1, callback) {
    var emailTo = config.get('email.to'),
        emailFrom = config.get('email.from');

    assert(emailTo, 'Must configure email.to');
    assert(emailFrom, 'Must configure email.from');

    var htmlBody = this.buildHtmlDiff(ansiLogAndDiff);

    // Send email!
    debug("Sending email from=%s to=%s for repo=%s", emailFrom, emailTo, path.basename(repoUrl));
    var mailOptions = {
        from: emailFrom,
        to: emailTo,
        subject: "[Git] new commits in " + path.basename(repoUrl) + " " + remoteSha1.substring(0,8),

        // Use Buffer for the html to prevent chopped lines.
        // See https://github.com/andris9/Nodemailer/issues/309
        html: new Buffer(htmlBody)
    };

    if (this.mailTransporter === undefined) {
        // Initialize mailTransporter on first use.

        // Clone smtpOptions get a non-read-only object.
        // (Nodemailer needs to write to the object).
        this.mailTransporter = nodemailer.createTransport(_.clone(config.get('email.smtpOptions')));
    }

    this.mailTransporter.sendMail(mailOptions, callback);
};

/**
 * Convert ANSI text to HTML
 *
 * - Add html line breaks
 * - Encode xml entities so that HTML in the git diff doesn't get rendered.
 *
 * @param {string} ansiTxt
 * @return {string}
 */
GitNotifier.prototype.buildHtmlDiff = function(ansiTxt) {
    var encodedTxt = entities.encode(ansiTxt);

    return '' +
        '<div style="font-family: courier, monospace; white-space: pre; background-color: #000; color: #aaa; padding: 5px; font-size: 12px">' +
        convert.toHtml(encodedTxt) +
        '</div>';
};

/**
 * Get path to local clone of repo.
 *
 * @param {string} repoUrl
 * @returns {string}
 */
GitNotifier.prototype.localPath = function (repoUrl) {
    return this.REPO_JAIL + '/' + path.basename(repoUrl);
};

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