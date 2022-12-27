module.exports = {
    repoList: [

    ],

    tabsToSpaces: 4,

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
