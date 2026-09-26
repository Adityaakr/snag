#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { guardBrokenPipe, processIo } from './io.js';
import { main } from './main.js';

// Keys live in .env (BUILD_PROMPT START_HERE); the app loads it at runtime. Existing env vars win.
const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

guardBrokenPipe(process.stdout, (code) => process.exit(code));
process.exitCode = await main(process.argv.slice(2), processIo());
