/** CLI exit codes (BUILD_PROMPT 10.1). */
export const EXIT = {
  ok: 0,
  gateFailure: 1,
  usage: 2,
  provider: 3,
  budget: 4,
} as const;

/** An error the CLI reports as "what failed, why, and the exact fix". */
export class CliError extends Error {
  constructor(
    message: string,
    readonly fix: string,
    readonly exitCode: number = EXIT.usage,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
