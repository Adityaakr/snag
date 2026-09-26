import { BRAND } from '@remit/core';
import { calibrateCommand } from './commands/calibrate.js';
import { demoCommand } from './commands/demo.js';
import { doctorCommand } from './commands/doctor.js';
import { evalCommand } from './commands/eval.js';
import { extractCommand } from './commands/extract.js';
import { initCommand } from './commands/init.js';
import { mutateCommand } from './commands/mutate.js';
import { reportCommand } from './commands/report.js';
import { reviewCommand } from './commands/review.js';
import { unitsCommand } from './commands/units.js';
import { CliError, EXIT } from './errors.js';
import type { Io } from './io.js';

type Command = (argv: string[], io: Io) => Promise<number>;

interface CommandSpec {
  run: Command;
  summary: string;
  /** Usage line and options, shown by `<command> --help`. */
  help: string;
}

const s = BRAND.slug;

const COMMANDS: Record<string, CommandSpec> = {
  demo: {
    run: demoCommand,
    summary: 'Offline demo on two recorded reviews (no keys needed)',
    help: `${s} demo\n\nReplays golden scenarios 1 and 2 with scripted answers. Needs no keys and no network.`,
  },
  init: {
    run: async (argv, io) => initCommand(argv, io),
    summary: 'Write a commented .remit.yml and check env vars',
    help: `${s} init [--force]\n\n  --force   overwrite an existing .${s}.yml with the defaults`,
  },
  review: {
    run: (argv, io) => reviewCommand(argv, io),
    summary: 'Review a GitHub PR, or a local diff against an issue',
    help: `${s} review <pr-url>
${s} review --issue <url|file> [--issue ...] --diff <file|range> [--pr-body <file>]

  --json              print the full ReviewResult as JSON
  --markdown          print the PR comment markdown
  --sarif             print SARIF 2.1.0
  --out <dir>         write every output to a directory
  --offline           use recorded answers only (replay)
  --dry-run           estimate calls, tokens and cost without calling anything
  --budget-usd <n>    override the per-review budget
  --explain <id>      show the answers, thresholds and evidence behind one finding
  --config <path>     use a specific config file
  --verbose           structured logs on stderr

Exit codes: 0 ok, 1 gate failure, 2 usage or config error, 3 provider or network error, 4 budget exceeded.`,
  },
  extract: {
    run: (argv, io) => extractCommand(argv, io),
    summary: 'Requirements and open questions for an issue URL or markdown file',
    help: `${s} extract <issue-url|owner/repo#n|file> [--json] [--offline] [--config <path>]`,
  },
  doctor: {
    run: (argv, io) => doctorCommand(argv, io),
    summary: 'Check Node, keys, config, provider connectivity, model ids and rate limits',
    help: `${s} doctor [--config <path>]\n\nPrints a fix for every failed check. Exit 0 when all required checks pass, 3 otherwise, 2 for an invalid config.`,
  },
  eval: {
    run: (argv, io) => evalCommand(argv, io),
    summary: 'Run an evaluation corpus and write a report',
    help: `${s} eval <golden|mutations|swebench|shadow> [--split dev|test] [--gate] [--limit n] [--baseline single_pass|pr_agent] [--mode scripted|simulated|live]\n\nThe test split runs only with --gate. Reports go to eval/reports/<timestamp>/.`,
  },
  calibrate: {
    run: (argv, io) => calibrateCommand(argv, io),
    summary: 'Fit and store calibration from labeled dev data',
    help: `${s} calibrate [--mode simulated|live] [--passes n] [--limit n] [--out <dir>]\n\nFits isotonic maps per question key (identity below 50 samples), tunes thresholds on dev with the cost weights in config \`eval\`, and writes eval/calibration/<jev-model>/<question-set>.json.`,
  },
  mutate: {
    run: (argv, io) => mutateCommand(argv, io),
    summary: 'Generate mutation items from a seed',
    help: `${s} mutate --seed <path> | --all [--out <corpora-dir>]\n\nWrites the clean seed and every operator's item to the seed's split (70/30 by seed id).`,
  },
  report: {
    run: (argv, io) => reportCommand(argv, io),
    summary: 'Render an eval report',
    help: `${s} report <eval-run>\n\nRe-renders report.md and report.html from the run's metrics.json and item dumps.`,
  },
  units: {
    run: unitsCommand,
    summary: 'Debug view of change units and code facts for a diff file or git range',
    help: `${s} units --diff <file|base..head|base...head> [--json]`,
  },
};

export function usage(): string {
  const lines = [`Usage: ${s} <command> [options]`, '', 'Commands:'];
  for (const [name, c] of Object.entries(COMMANDS)) lines.push(`  ${name.padEnd(10)} ${c.summary}`);
  lines.push('', `Run \`${s} <command> --help\` for options.`);
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
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(`${command.help}\n`);
    return EXIT.ok;
  }
  try {
    return await command.run(rest, io);
  } catch (e) {
    if (e instanceof CliError) {
      io.err(`${e.message}\nFix: ${e.fix}\n`);
      return e.exitCode;
    }
    if (e instanceof TypeError && /Unknown option|unexpected argument|argument missing/i.test(e.message)) {
      io.err(`${e.message}\n\n${command.help}\n`);
      return EXIT.usage;
    }
    io.err(`${BRAND.name} failed unexpectedly: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT.provider;
  }
}
