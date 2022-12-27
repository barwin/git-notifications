module.exports = {
    repoList: [

    ],

    tabsToSpaces: 4,

    // Restrict the size of the raw text (before converting to HTML).
    ansiSizeLimitBytes: 1024 * 1000,

    email: {

        to: undefined,
        from: undefined,

        // See https://nodemailer.com/smtp
        smtpOptions: {
            host: 'localhost',
            port: 25,
            secure: false,
            auth: {
                user: 'username',
                pass: 'password',
            },
        },
    },
};
