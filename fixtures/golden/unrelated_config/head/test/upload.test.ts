import { expect, it, vi } from 'vitest';
import { upload } from '../src/upload';

it('retries three times', async () => {
  const send = vi.fn().mockRejectedValue(new Error('x'));
  await expect(upload(send)).rejects.toThrow('x');
  expect(send).toHaveBeenCalledTimes(3);
});
