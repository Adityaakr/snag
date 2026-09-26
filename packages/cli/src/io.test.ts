import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { guardBrokenPipe } from './io.js';

describe('guardBrokenPipe', () => {
  it('exits 0 on EPIPE', () => {
    const stream = new EventEmitter();
    const codes: number[] = [];
    guardBrokenPipe(stream, (c) => codes.push(c));
    stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    expect(codes).toEqual([0]);
  });

  it('rethrows other stream errors', () => {
    const stream = new EventEmitter();
    guardBrokenPipe(stream, () => {});
    expect(() => stream.emit('error', Object.assign(new Error('boom'), { code: 'EIO' }))).toThrow('boom');
  });
});
