#!/usr/bin/env node
import { guardBrokenPipe, processIo } from './io.js';
import { main } from './main.js';

guardBrokenPipe(process.stdout, (code) => process.exit(code));
process.exitCode = await main(process.argv.slice(2), processIo());
