import net from 'node:net';
import { describe, expect, it } from 'vitest';

// Proves the shared test setup blocks outbound network (BUILD_PROMPT 12).
describe('unit test network block', () => {
  it('rejects fetch to a remote host', async () => {
    await expect(fetch('https://api.typesafe.ai/v1/systemone')).rejects.toThrow(/Network access is blocked/);
  });

  it('rejects raw sockets to a remote host', () => {
    expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow(/Network access is blocked/);
  });
});
