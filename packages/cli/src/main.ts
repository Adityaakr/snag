import { BRAND } from '@remit/core';
import { doctorCommand } from './commands/doctor.js';
import { unitsCommand } from './commands/units.js';
import { CliError, EXIT } from './errors.js';
import type { Io } from './io.js';

type Command = (argv: string[], io: Io) => Promise<number>;

const COMMANDS: Record<string, { run: Command; summary: string }> = {
  doctor: {
    run: (argv, io) => doctorCommand(argv, io),
    summary: 'Check Node, keys, config, provider connectivity, model ids and rate limits',
  },
  units: {
    run: unitsCommand,
    summary: 'Debug view of change units and code facts for a diff file or git range',
  },
};

export function usage(): string {
  const lines = [`Usage: ${BRAND.slug} <command> [options]`, '', 'Commands:'];
  for (const [name, c] of Object.entries(COMMANDS)) lines.push(`  ${name.padEnd(10)} ${c.summary}`);
  lines.push('', `Run \`${BRAND.slug} <command> --help\` for options.`);
  return `${lines.join('\n')}\n`;
}

/** Runs the CLI and returns the exit code. Never throws. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    io.out(usage());
    return name ? EXIT.ok : EXIT.usage;
  }
  const command = COMMANDS[name];
  if (!command) {
    io.err(`Unknown command "${name}".\n\n${usage()}`);
    return EXIT.usage;
  }
  try {
    return await command.run(rest, io);
  } catch (e) {
    if (e instanceof CliError) {
      io.err(`${e.message}\nFix: ${e.fix}\n`);
      return e.exitCode;
    }
    if (e instanceof TypeError && /Unknown option|unexpected argument|argument missing/i.test(e.message)) {
      io.err(`${e.message}\nFix: run \`${BRAND.slug} ${name} --help\`.\n`);
      return EXIT.usage;
    }
    io.err(`${BRAND.name} failed unexpectedly: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.provider;
  }
}
