/**
 * Encrypted storage for App credentials (BUILD_PROMPT 9.8, 10.2 setup): AES-256-GCM with a key derived from
 * SECRETS_ENCRYPTION_KEY. Without that key, `/setup` shows the credentials once for env configuration instead.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
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

const keyOf = (secret: string) => createHash('sha256').update(secret).digest();

export function encrypt(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(
    '.',
  );
}

export function decrypt(token: string, secret: string): string {
  const [v, iv, tag, body] = token.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('not an encrypted secret');
  const d = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64'));
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
  async save(s: AppSecrets) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${encrypt(JSON.stringify(s), this.key)}\n`, { mode: 0o600 });
  }
  async load() {
    if (!existsSync(this.path)) return null;
    return JSON.parse(decrypt(readFileSync(this.path, 'utf8').trim(), this.key)) as AppSecrets;
  }
}
