/**
 * Static checks of the container setup (BUILD_PROMPT M9). The full stack runs in `pnpm stack:smoke` (slow test)
 * with the same entry points; `docker compose up` itself needs a container runtime (see .agent/BLOCKERS.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const compose = parse(readFileSync(join(root, 'docker-compose.yml'), 'utf8'), { merge: true }) as {
  services: Record<
    string,
    {
      healthcheck?: unknown;
      depends_on?: Record<string, { condition: string }>;
      environment?: Record<string, string>;
      profiles?: string[];
      build?: unknown;
      image?: string;
      volumes?: string[];
    }
  >;
};

describe('Dockerfile', () => {
  it('is multi-stage, runs as a non-root user, and has a health check', () => {
    expect(dockerfile.match(/^FROM /gm)?.length).toBeGreaterThanOrEqual(3);
    const runtime = dockerfile.slice(dockerfile.lastIndexOf('FROM '));
    expect(runtime).toMatch(/^USER node$/m);
    expect(runtime).not.toMatch(/^USER root$/m);
    expect(runtime).toMatch(/HEALTHCHECK/);
    expect(runtime).toMatch(/CMD \["node", "packages\/server\/dist\/main\.js"\]/);
    expect(dockerfile).toMatch(/--frozen-lockfile/);
  });

  it('compiles from scratch: stale build info never reaches the build stage', () => {
    const ignore = readFileSync(join(root, '.dockerignore'), 'utf8').split('\n');
    expect(ignore).toContain('**/dist');
    expect(ignore).toContain('**/*.tsbuildinfo');
    expect(dockerfile).toMatch(/tsc -b --force packages\/server/);
  });

  it('creates and hands to node every volume mount target the image uses in compose', () => {
    const runtime = dockerfile.slice(dockerfile.lastIndexOf('FROM '));
    const targets = new Set<string>();
    for (const svc of Object.values(compose.services)) {
      if (!svc.build && !svc.image?.startsWith('remit')) continue;
      for (const v of svc.volumes ?? []) {
        const target = v.split(':')[1];
        if (target) targets.add(target);
      }
    }
    expect(targets.size).toBeGreaterThan(0);
    const mkdir = runtime.match(/^RUN mkdir -p ([^&]+)&& chown node:node (.+)$/m);
    expect(mkdir, 'RUN mkdir -p ... && chown node:node ...').not.toBeNull();
    for (const t of targets) {
      expect(mkdir?.[1]?.split(/\s+/), t).toContain(t);
      expect(mkdir?.[2]?.split(/\s+/), t).toContain(t);
    }
  });
});

describe('docker-compose.yml', () => {
  it('has the server, the worker and Postgres with health checks, ordered so the server migrates first', () => {
    const s = compose.services;
    for (const name of ['postgres', 'server', 'worker']) expect(s[name]?.healthcheck, name).toBeDefined();
    expect(s.server?.environment?.REMIT_ROLE).toBe('web');
    expect(s.worker?.environment?.REMIT_ROLE).toBe('worker');
    expect(s.server?.depends_on?.postgres?.condition).toBe('service_healthy');
    expect(s.worker?.depends_on?.server?.condition).toBe('service_healthy');
  });

  it('works with fakes by default: a fake GitHub and no required credentials', () => {
    const s = compose.services;
    expect(s['fake-github']?.healthcheck).toBeDefined();
    expect(s.server?.environment?.GITHUB_API_URL).toBe(
      ['${GITHUB_API_URL:-', 'http://fake-github:4000}'].join(''),
    );
    expect(s.server?.environment?.GITHUB_WEBHOOK_SECRET_FILE).toMatch(/\/shared\/webhook-secret/);
    expect(s.smoke?.profiles).toEqual(['smoke']);
  });
});
