/**
 * Encrypted storage for App credentials (BUILD_PROMPT 9.8, 10.2 setup): AES-256-GCM with a key derived from
 * SECRETS_ENCRYPTION_KEY. Without that key, `/setup` shows the credentials once for env configuration instead.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AppSecrets {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
}

/** Keys shorter than this are refused: they could be brute-forced offline against the GCM tag. */
export const MIN_KEY_LENGTH = 32;
const AAD = Buffer.from('remit-app-secrets-v2');

function keyOf(secret: string, salt: Buffer): Buffer {
  if (secret.length < MIN_KEY_LENGTH)
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters (use \`openssl rand -base64 48\`).`,
    );
  return scryptSync(secret, salt, 32, { N: 16_384, r: 8, p: 1 });
}

export function encrypt(plaintext: string, secret: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret, salt), iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v2', salt, iv, cipher.getAuthTag(), body]
    .map((x) => (typeof x === 'string' ? x : x.toString('base64')))
    .join('.');
}

export function decrypt(token: string, secret: string): string {
  const [v, salt, iv, tag, body] = token.split('.');
  if (v !== 'v2' || !salt || !iv || !tag || !body) throw new Error('not an encrypted secret');
  const d = createDecipheriv(
    'aes-256-gcm',
    keyOf(secret, Buffer.from(salt, 'base64')),
    Buffer.from(iv, 'base64'),
  );
  d.setAAD(AAD);
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}

export interface SecretStore {
  save(s: AppSecrets): Promise<void>;
  load(): Promise<AppSecrets | null>;
}

export class FileSecretStore implements SecretStore {
  constructor(
    private readonly path: string,
    private readonly key: string,
  ) {}
  /** Never replaces stored credentials: delete the file deliberately to set the App up again. */
  async save(s: AppSecrets) {
    if (existsSync(this.path))
      throw new Error('App credentials are already stored; refusing to overwrite them.');
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${encrypt(JSON.stringify(s), this.key)}\n`, { mode: 0o600, flag: 'wx' });
  }
  async load() {
    if (!existsSync(this.path)) return null;
    return JSON.parse(decrypt(readFileSync(this.path, 'utf8').trim(), this.key)) as AppSecrets;
  }
}
