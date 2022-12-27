const assert = require('assert');
const Bluebird = require('bluebird');
const config = require('config');
const Convert = require('ansi-to-html');

const convert = new Convert();
const debug = require('debug')('gitnotifier:gitNotifier');
const fs = require('fs');
const Entities = require('html-entities').XmlEntities;

const entities = new Entities();
const nodemailer = require('nodemailer');
const path = require('path');
const _ = require('underscore');
const Git = require('./git-wrapper-local');
_.str = require('underscore.string');

class GitNotifier {
    /**
     *
     * @constructor
     */
    constructor() {
        // Local path where we will clone and track repos.
        this.REPO_JAIL = `${__dirname}/../var`;

        debug('Checking if %s exists', this.REPO_JAIL);
        if (!fs.existsSync(this.REPO_JAIL)) {
            debug(`Creating repo jail directory: ${this.REPO_JAIL}`);
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
    async cloneRepoIfNotExists(repoUrl) {
        const localRepoPath = this.localPath(repoUrl);

        const exists = fs.existsSync(localRepoPath);
        if (!exists) {
            debug(`Repo ${repoUrl} does not exist locally yet. Cloning to ${localRepoPath}`);
            await Bluebird.fromCallback(cb => {
                new Git().exec('clone', { bare: true, depth: 1 }, [repoUrl, localRepoPath], cb);
            });

            debug('Successfully cloned repo: %s', path.basename(repoUrl));
        }
    }

    /**
     * Fetches new commits from origin, and returns the diff.
     *
     * @param {string} repoUrl
     * @param {function} callback (err, diff, localSha1, latestSha1)
     * @return {Promise<object>}
     */
    async checkForNewCommits(repoUrl) {
        const localRepoPath = this.localPath(repoUrl);
        const git = new Git({ 'git-dir': localRepoPath });
        const gitExec = (cmd, opts, args) => Bluebird.fromCallback(cb => git.exec(cmd, opts, args, cb));

        const localBranchName = (await gitExec('name-rev', { 'name-only': true }, ['HEAD'])).trim();

        // get latest LOCAL sha1
        const localSha1 = (await gitExec('rev-parse', {}, ['HEAD'])).trim();

        // get latest REMOTE sha1
        const remoteSha1Line = await gitExec('ls-remote', {}, ['origin', localBranchName]);
        const remoteSha1 = remoteSha1Line.split(/\s/)[0];

        if (localSha1 === remoteSha1) {
            // no new commits
            debug(`No new commits found for ${path.basename(repoUrl)}`);
        }
        else {
            // We have new commits!
            debug("There are new commits in repo '%s' %s..%s!", path.basename(repoUrl), localSha1, remoteSha1);
            // Fetch, log, and diff
            const refSpec = `${localBranchName}:${localBranchName}`;
            await gitExec('fetch', {}, ['origin', refSpec]);

            // Git 'log' and 'diff' take [mostly] the same flags/args.
            // So define here for convenience.
            const gitOpts = { color: true, paginate: false };
            const gitArgs = [`${localSha1}..${remoteSha1}`];

            const [ansiLog, ansiDiff] = await Promise.all([
                gitExec('log', _.extend(_.clone(gitOpts), { stat: true }), gitArgs),
                gitExec('diff', gitOpts, gitArgs),
            ]);

            return {
                ansiLogAndDiff: `${ansiLog}\n\n${ansiDiff}`,
                localSha1,
                remoteSha1,
            };
        }

        return {};
    }

    /**
     * Fire off the email containing our git diff
     *

     * @param {string} ansiLogAndDiff
     * @param {string} localSha1
     * @param {string} remoteSha1
     * @param {function} callback
     */
    async sendEmailNotification(repoUrl, ansiLogAndDiff, localSha1, remoteSha1) {
        const emailTo = config.get('email.to');
        const emailFrom = config.get('email.from');

        assert(emailTo, 'Must configure email.to');
        assert(emailFrom, 'Must configure email.from');

        const htmlBody = this.buildHtmlDiff(repoUrl, ansiLogAndDiff, localSha1, remoteSha1);

        // Send email!
        debug('Sending email from=%s to=%s for repo=%s', emailFrom, emailTo, path.basename(repoUrl));
        const mailOptions = {
            from: emailFrom,
            to: emailTo,
            subject: `[Git] new commits in ${path.basename(repoUrl)} ${
                localSha1.substring(0, 7)}..${remoteSha1.substring(0, 7)}`,

            // Use Buffer for the html to prevent chopped lines.
            // See https://github.com/andris9/Nodemailer/issues/309
            html: Buffer.from(htmlBody),
        };

        if (this.mailTransporter === undefined) {
            // Initialize mailTransporter on first use.

            // Clone smtpOptions get a non-read-only object.
            // (Nodemailer needs to write to the object).
            this.mailTransporter = nodemailer.createTransport(_.clone(config.get('email.smtpOptions')));
        }

        return Bluebird.fromCallback(cb => this.mailTransporter.sendMail(mailOptions, cb));
    }

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
    buildHtmlDiff(repoUrl, ansiTxt, localSha1, remoteSha1) {
        let modifiedAnsiText = ansiTxt;
        if (config.has('ansiSizeLimitBytes')) {
            modifiedAnsiText = _.str.truncate(modifiedAnsiText, config.get('ansiSizeLimitBytes'), ' ... [truncated]');
        }

        const tabsToSpaces = config.has('tabsToSpaces') ? config.get('tabsToSpaces') : null;
        if (tabsToSpaces) {
            modifiedAnsiText = modifiedAnsiText.replace(/\t/g, _.str.repeat(' ', tabsToSpaces));
        }

        const encodedTxt = entities.encode(modifiedAnsiText);

        let headerHtml = '';
        if (this.isGitHubRepo(repoUrl)) {
            headerHtml = `<a href="${
                this.getGitHubWebDiffUrl(repoUrl, localSha1, remoteSha1)}">View this diff on GitHub</a><br><br>`;
        }

        return `${'<!doctype html>\n'
            + '<html>'
            + '<head>'
            + '<meta charset="utf-8">'
            + '</head>'
            + '<body>'}${
            headerHtml
        }<div style="font-family: courier, monospace; white-space: pre; background-color: #111; color: #aaa; padding: 5px; font-size: 12px">${
            convert.toHtml(encodedTxt)
        }</div>`
            + '</body>'
            + '</html>';
    }

    /**
     * Get path to local clone of repo.
     *
     * @param {string} repoUrl
     * @returns {string}
     */
    localPath(repoUrl) {
        return `${this.REPO_JAIL}/${path.basename(repoUrl)}`;
    }

    /**
     * Determine if repo is a GitHub repo.
     *
     * @param {string} repoUrl
     * @returns {boolean} True if repo is a GitHub Repo, false otherwise.
     */
    isGitHubRepo(repoUrl) {
        return this.reGitHub.test(repoUrl);
    }

    /**
     * Given a GitHub repo url, and two commit sha1s, return a link to a GitHub diff.
     *
     * @param {string} repoUrl
     * @param {string} beginSha1
     * @param {string} endSha1
     * @returns {string}
     */
    getGitHubWebDiffUrl(repoUrl, beginSha1, endSha1) {
        const matches = repoUrl.match(this.reGitHub);
        if (matches[1]) {
            // remove trailing '.git'
            let repoPath = matches[1].replace(/\.git$/, '');

            if (repoPath.indexOf('/') !== 0) {
                // Ensure leading slash.
                repoPath = `/${repoPath}`;
            }
            return `https://github.com${repoPath}/compare/${beginSha1}...${endSha1}`;
        }
        return '';
    }
}

module.exports = GitNotifier;
