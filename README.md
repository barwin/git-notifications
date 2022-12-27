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

        tabsToSpaces: 4,

        // Restrict the size of the raw text (before converting to HTML).
        ansiSizeLimitBytes: 1024*1000,

        email: {
            from: 'user@domain',
            to: 'your@recipients, another@recipient',

            // See https://nodemailer.com/smtp/
            smtpOptions: {
                host: 'localhost',
                port: 25,
                auth: {
                    user: 'username',
                    pass: 'password'
                }
            }
        }
    };

# Running

Run with node:

    node .

## Debugging

You can see debug output by setting the ```DEBUG``` environment variable. E.g.

    DEBUG=* node .

## Run Tests

    npm test
