# Git Notifier

Watch git repos and send commit notifications (with diffs) via email.

# Config

Edit ```config/default.js``` and define your repos and email preferences.

For Example:

    module.exports = {
        repoList: [
            { gitUrl: 'https://github.com/path/to-repo1.git' },
            { gitUrl: '../path/to/local/repo' },
            { gitUrl: 'git@private:/repo.git' }
        ],

        email: {
            from: 'user@domain',
            to: 'your@recipients'
        }
    };

# Running

Just run the script with node:

    node .
