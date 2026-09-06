#!/usr/bin/env node
import { run } from '../out/main.js';

// A reader that stops reading -- `| head`, a pager quit -- closes stdout
// underneath us. That is their decision, not an error.
process.stdout.on('error', error => {
    if (error.code !== 'EPIPE') {
        throw error;
    }
});

process.exitCode = await run(process.argv.slice(2));
