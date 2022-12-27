require('should');

const assert = require('assert');
const Bluebird = require('bluebird');
const fs = require('fs');
const temp = require('temp');
const Git = require('../lib/git-wrapper-local');

// Automatically track and cleanup files at exit
temp.track();

// Set NODE_ENV so that config/local-testing.js is loaded.
if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'testing';
}

describe('lib/gitNotifier', function() {
    const GitNotifier = require('../lib/gitNotifier');
    let gitNotifier;

    before(function(done) {
        gitNotifier = new GitNotifier();

        temp.mkdir('test_repo_jail', function(err, tmpDirPath) {
            gitNotifier.REPO_JAIL = tmpDirPath;
            done();
        });
    });

    describe('cloneRepoIfNotExists', function() {
        it('should clone repo into REPO_JAIL dir', async () => {
            await gitNotifier.cloneRepoIfNotExists('https://github.com/barwin/git-notifications.git');

            const exists = fs.existsSync(`${gitNotifier.REPO_JAIL}/git-notifications.git`);
            exists.should.equal(true);
        });

        it('should throw an error when the repo does not exist', async () => {
            const unexpectedErrMessage = 'should not get here, unexpected error';
            try {
                await gitNotifier.cloneRepoIfNotExists('file:///noexist');
                throw new Error(unexpectedErrMessage);
            }
            catch (err) {
                err.should.be.instanceof(Error);
                err.message.should.not.equal(unexpectedErrMessage);
            }

            const exists = fs.existsSync(`${gitNotifier.REPO_JAIL}/noexist`);
            exists.should.equal(false);
        });
    });

    describe('checkForNewCommits', function() {
        let tmpRepoOriginPath;
        const tmpRepoName = 'testRepo';
        let git;
        let gitExec;

        /**
         * Initialize a local repo with a single commit.
         */
        before(async () => {
            const tmpDirPath = await Bluebird.fromCallback(cb => temp.mkdir('test_checkForNewCommits', cb));

            tmpRepoOriginPath = `${tmpDirPath}/${tmpRepoName}`;
            fs.mkdirSync(tmpRepoOriginPath);
            git = new Git({ 'git-dir': `${tmpRepoOriginPath}/.git`, cwd: tmpRepoOriginPath });
            gitExec = (cmd, opts, args) => {
                return Bluebird.fromCallback(cb => git.exec(cmd, opts, args, cb));
            };

            // Initialie repo and add an initial commit
            await gitExec('init', {}, [tmpRepoOriginPath]);
            fs.writeFileSync(`${tmpRepoOriginPath}/test.txt`, 'Hello World');
            await gitExec('add', {}, ['test.txt']);
            await gitExec('commit', { m: "'First commit'" }, []);
        });

        it('should clone local temp repo without error', async () => {
            await gitNotifier.cloneRepoIfNotExists(tmpRepoOriginPath);
            const exists = fs.existsSync(`${gitNotifier.REPO_JAIL}/${tmpRepoName}`);
            exists.should.equal(true);
        });

        it('should not find new commits with an initial clone repo', async () => {
            const { ansiLogAndDiff, remoteSha1 } = await gitNotifier.checkForNewCommits(tmpRepoOriginPath);
            assert.equal(ansiLogAndDiff, undefined, 'Diff should be undefined');
            assert.equal(remoteSha1, undefined, 'LatestSha1 should be undefined');
        });

        it('should find new commits', async () => {
            // Add a test commit that should get discovered
            fs.writeFileSync(`${tmpRepoOriginPath}/newfile`, 'a new file!');
            await gitExec('add', {}, ['newfile']);
            await gitExec('commit', { m: "'Second Commit'" }, []);

            const { ansiLogAndDiff, localSha1, remoteSha1 } = await gitNotifier.checkForNewCommits(tmpRepoOriginPath);
            assert.ok(localSha1, 'localSha1 should be ok');
            ansiLogAndDiff.should.be.type('string');
            remoteSha1.should.be.type('string');
        });
    });

    describe('isGitHubRepo', function() {
        it('should return true for github repos', function() {
            [
                'https://github.com/barwin/git-notifications.git',
                'https://github.com/barwin/git-notifications',
                'git@github.com:barwin/git-notifications.git',
            ]
                .forEach(function(repoUrl) {
                    assert.ok(gitNotifier.isGitHubRepo(repoUrl), `true for github repo: ${repoUrl}`);
                });
        });

        it('should return false for non-github repos', function() {
            [
                'file:///Users/barwin/sites/test_repo',
                'git@bitbucket.org:testuser/test_repo.git',
                'https://testuser@bitbucket.org/testuser/notify_bot.git',
            ]
                .forEach(function(repoUrl) {
                    assert.equal(gitNotifier.isGitHubRepo(repoUrl), false, `false for non-github repo: ${repoUrl}`);
                });
        });
    });

    describe('getGitHubWebDiffUrl', function() {
        const expectedCompareUrl = 'https://github.com/barwin/git-notifications/compare/foo...bar';

        it('should get urls for ssh repoUrls', function() {
            assert.equal(
                gitNotifier.getGitHubWebDiffUrl('git@github.com:barwin/git-notifications.git', 'foo', 'bar'),
                expectedCompareUrl,
            );
        });

        it('should get urls for https repoUrls with .git extension', function() {
            assert.equal(
                gitNotifier.getGitHubWebDiffUrl('https://github.com/barwin/git-notifications.git', 'foo', 'bar'),
                expectedCompareUrl,
            );
        });

        it('should get urls for https repoUrls without .git extension', function() {
            assert.equal(
                gitNotifier.getGitHubWebDiffUrl('https://github.com/barwin/git-notifications', 'foo', 'bar'),
                expectedCompareUrl,
            );
        });
    });

    describe.skip('sendEmailNotification', function() {

    });
});
