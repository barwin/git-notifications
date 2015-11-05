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
_.str = require('underscore.string');

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

    /**
     * Regex that matches GitHub repo urls, and captures the repo path as the first match.
     * @type {RegExp}
     */
    this.reGitHub = /^(?:git@|https:\/\/)github\.com(?:\/|:)(.*)(?:\.git)?$/;
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
 * @param {function} callback (err, diff, localSha1, latestSha1)
 */
GitNotifier.prototype.checkForNewCommits = function (repoUrl, callback) {

    var localRepoPath = this.localPath(repoUrl),
        localBranchName,
        git = new Git({ 'git-dir': localRepoPath });

    ASQ()
        .then(function(done) {
            // get current local branch
            git.exec('name-rev', { 'name-only': true }, ['HEAD'], function(err, branchName) {
                if (err) { done.fail(err); }
                else {
                    localBranchName = branchName.trim();
                    done();
                }
            });
        })
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
            git.exec('ls-remote', {}, [ 'origin', localBranchName ], function(err, remoteSha1Line) {
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
                var refspec = localBranchName + ':' + localBranchName;
                git.exec('fetch', {}, [ 'origin', refspec ], function(err) {
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
                                    done(ansiLog + "\n\n" + ansiDiff, localSha1, remoteSha1);
                                }
                            });
                    }
                });
            }
        })
        .val(function(ansiLogAndDiff, localSha1, remoteSha1) {
            doCallback(callback, [null, ansiLogAndDiff, localSha1, remoteSha1]);
        })
        .or(function(err) {
            doCallback(callback, [err]);
        });
};


/**
 * Fire off the email containing our git diff
 *

 * @param {string} ansiLogAndDiff
 * @param {string} localSha1
 * @param {string} remoteSha1
 * @param {function} callback
 */
GitNotifier.prototype.sendEmailNotification = function (repoUrl, ansiLogAndDiff, localSha1, remoteSha1, callback) {
    var emailTo = config.get('email.to'),
        emailFrom = config.get('email.from');

    assert(emailTo, 'Must configure email.to');
    assert(emailFrom, 'Must configure email.from');

    var htmlBody = this.buildHtmlDiff(repoUrl, ansiLogAndDiff, localSha1, remoteSha1);

    // Send email!
    debug("Sending email from=%s to=%s for repo=%s", emailFrom, emailTo, path.basename(repoUrl));
    var mailOptions = {
        from: emailFrom,
        to: emailTo,
        subject: "[Git] new commits in " + path.basename(repoUrl) + " " +
            localSha1.substring(0,7) + ".." + remoteSha1.substring(0,7),

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
 * - Truncate ANSI text if over configured size limit.
 * - Add html line breaks.
 * - Encode xml entities so that HTML in the git diff doesn't get rendered.
 *
 * @param {string} repoUrl
 * @param {string} ansiTxt
 * @param {string} localSha1
 * @param {string} remoteSha1
 * @return {string}
 */
GitNotifier.prototype.buildHtmlDiff = function(repoUrl, ansiTxt, localSha1, remoteSha1) {

    if (config.has('ansiSizeLimitBytes')) {
        ansiTxt = _.str.truncate(ansiTxt, config.get('ansiSizeLimitBytes'), ' ... [truncated]');
    }

    var tabsToSpaces = config.has('tabsToSpaces') ? config.get('tabsToSpaces') : null;
    if (tabsToSpaces) {
        ansiTxt = ansiTxt.replace(/\t/g, _.str.repeat(' ', tabsToSpaces));
    }

    var encodedTxt = entities.encode(ansiTxt);

    var headerHtml = '';
    if (this.isGitHubRepo(repoUrl)) {
        headerHtml = '<a href="' +
            this.getGitHubWebDiffUrl(repoUrl, localSha1, remoteSha1) + '">View this diff on GitHub</a><br><br>';
    }

    return '<!doctype html>\n' +
        '<html>' +
        '<head>' +
        '<meta charset="utf-8">' +
        '</head>' +
        '<body>' +
        headerHtml +
        '<div style="font-family: courier, monospace; white-space: pre; background-color: #111; color: #aaa; padding: 5px; font-size: 12px">' +
        convert.toHtml(encodedTxt) +
        '</div>' +
        '</body>' +
        '</html>';
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
 * Determine if repo is a GitHub repo.
 *
 * @param {string} repoUrl
 * @returns {boolean} True if repo is a GitHub Repo, false otherwise.
 */
GitNotifier.prototype.isGitHubRepo = function(repoUrl) {
    return this.reGitHub.test(repoUrl);
};

/**
 * Given a GitHub repo url, and two commit sha1s, return a link to a GitHub diff.
 *
 * @param {string} repoUrl
 * @param {string} beginSha1
 * @param {string} endSha1
 * @returns {string}
 */
GitNotifier.prototype.getGitHubWebDiffUrl = function(repoUrl, beginSha1, endSha1) {
    var matches = repoUrl.match(this.reGitHub);
    if (matches[1]) {
        // remove trailing '.git'
        var repoPath = matches[1].replace(/\.git$/, '');

        if (repoPath.indexOf('/') !== 0) {
            // Ensure leading slash.
            repoPath = '/' + repoPath;
        }
        return 'https://github.com' + repoPath + '/compare/' + beginSha1 + '...' + endSha1;
    }
    return '';
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
