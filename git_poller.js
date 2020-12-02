const Bluebird = require('bluebird');
const config = require('config');
const debug = require('debug')('gitnotifier:git_poller');
const path = require('path');

const GitNotifier = require('./lib/gitNotifier');

const gitNotifier = new GitNotifier();
(async () => {
    await Bluebird.each(config.get('repoList'), async (repo) => {
        const repoUrl = repo.gitUrl;
        debug(`${repoUrl} => ${path.basename(repoUrl)}`);

        try {
            await gitNotifier.cloneRepoIfNotExists(repoUrl);
            const { ansiLogAndDiff, localSha1, remoteSha1 } = await gitNotifier.checkForNewCommits(repoUrl);
            if (ansiLogAndDiff) {
                const info = await gitNotifier.sendEmailNotification(repoUrl, ansiLogAndDiff, localSha1, remoteSha1);
                debug(`Email sent: ${info.response}`);
            }
        }
        catch (err) {
            console.error(`Bailing out on repo ${repoUrl}:`, err);
        }
    });
})()
    .catch(err => {
        console.warn(err);
        process.exit(1);
    });
