import { expect, it } from 'vitest';
import { getUser } from '../src/api/users';

it('rejects unknown ids', () => {
  expect(getUser('nope').status).toBe(400);
});
