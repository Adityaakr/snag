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
