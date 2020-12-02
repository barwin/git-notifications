const ASQ = require('asynquence');
const config = require('config');
const debug = require('debug')('gitnotifier:git_poller');
const path = require('path');
const _ = require('underscore');

const GitNotifier = require('./lib/gitNotifier');

const gitNotifier = new GitNotifier();

_.each(config.get('repoList'), (repo) => {
    const repoUrl = repo.gitUrl;
    debug(`${repoUrl} => ${path.basename(repoUrl)}`);

    ASQ()
        .then((done) => {
            // Check that repo is checked out in our 'jail'
            gitNotifier.cloneRepoIfNotExists(repoUrl, (err) => {
                if (err) {
                    console.error(`Failed to clone repo: ${repoUrl}:`, err);
                    done.fail(err);
                }
                else {
                    done();
                }
            });
        })
        .then(async (done) => {
            const { ansiLogAndDiff, localSha1, remoteSha1 } = await gitNotifier.checkForNewCommits(repoUrl);
            if (ansiLogAndDiff) {
                done(ansiLogAndDiff, localSha1, remoteSha1);
            }
            else {
                // Nothing left to do if there is no diff.
                done.abort();
            }
        })
        .then((done, ansiLogAndDiff, localSha1, remoteSha1) => {
            gitNotifier.sendEmailNotification(repoUrl, ansiLogAndDiff, localSha1, remoteSha1, (err, info) => {
                if (err) {
                    console.error('Failed to send email:', err);
                    done.fail(err);
                }
                else {
                    debug(`Email sent: ${info.response}`);
                    done();
                }
            });
        })
        .or((err) => {
            console.error('Bailing out on repo %s:', repoUrl, err);
        });
});
