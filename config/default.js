module.exports = {
    repoList: [

    ],

    email: {

        to: undefined,
        from: undefined,

        // See https://github.com/andris9/nodemailer-smtp-transport#usage
        smtpOptions: {
            host: 'localhost',
            port: 25,
            secure: false,
            auth: {
                user: 'username',
                pass: 'password'
            }
        }
    }
};