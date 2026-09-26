/** Where CLI output goes; tests pass string sinks. */
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
}

export function processIo(): Io {
  return {
    out: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t),
    cwd: process.cwd(),
    env: process.env,
  };
}

/**
 * Exits quietly when stdout closes early (for example `remit units --json | head`) instead of crashing with an
 * EPIPE stack trace. Other stream errors still throw.
 */
export function guardBrokenPipe(stream: NodeJS.EventEmitter, exit: (code: number) => void): void {
  stream.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EPIPE') exit(0);
    else throw e;
  });
}
