#!/usr/bin/env node
import { processIo } from './io.js';
import { main } from './main.js';

process.exitCode = await main(process.argv.slice(2), processIo());
