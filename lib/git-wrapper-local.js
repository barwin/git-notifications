// imports
const { spawn } = require('child_process');

class Git {
    constructor(options = {}) {
        this.binary = 'git';

        const { cwd, ...remainingOptions } = options;
        this.cwd = cwd || process.cwd();

        this.args = Git.optionsToArray(remainingOptions);
    }

    // git.exec(command, options, args, callback)
    exec(command, options, args, callback) {
        // Put all the args and options together and send as one array to spawn.
        const cmdArgs = this.args
            .concat(command)
            .concat(Git.optionsToArray(options))
            .concat(args);

        this.spawnCommand(this.binary, cmdArgs, callback);
    }

    /**
     * Spawns command
     *
     * @param {string} binary
     * @param {Array} cmdArgs
     * @param {function} callback
     */
    spawnCommand(binary, cmdArgs, callback) {
        const gitproc = spawn(binary, cmdArgs, { cwd: this.cwd });
        let output = '';
        let errorOutput = '';

        // collect stdout
        gitproc.stdout.on('data', (data) => {
            output += data;
        });

        // collect stderr
        gitproc.stderr.on('data', (data) => {
            errorOutput += data;
        });

        gitproc.on('close', (code) => {
            if (code === 0) {
                callback(null, output);
            }
            else {
                callback(new Error(errorOutput), output);
            }
        });

        gitproc.on('error', (err) => {
            callback(err);
        });
    }

    // converts an object that contains key value pairs to a args array suitable for child_process.spawn
    static optionsToArray(options) {
        const args = [];

        Object.keys(options).forEach(k => {
            const val = options[k];

            if (k.length === 1) {
                // val is true, add '-k'
                if (val === true) args.push(`-${k}`);
                // if val is not false, add '-k val'
                else if (val !== false) args.push(`-${k} ${val}`);
            }
            else if (val === true) args.push(`--${k}`);
            else if (val !== false) args.push(`--${k}=${val}`);
        });
        return args;
    }
}

module.exports = Git;
