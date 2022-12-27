module.exports = {
    env: {
        es2020: true,
    },
    extends: [
        'airbnb-base',
    ],
    rules: {
        'arrow-body-style': [0],
        'arrow-parens': [0],
        'brace-style': [2, 'stroustrup', { allowSingleLine: true }],
        indent: ['error', 4],
        'max-len': [1, { code: 130, tabWidth: 4, ignoreUrls: true }],
        'no-use-before-define': ['error', { functions: false }],
        'space-before-function-paren': [2, { anonymous: 'never', named: 'never', asyncArrow: 'always' }],
    },
};
