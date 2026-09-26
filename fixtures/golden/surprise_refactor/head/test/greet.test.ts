import { expect, it } from 'vitest';
import { greet } from '../src/greet';

it('greets by name', () => {
  expect(greet('Ada')).toBe('Hello Ada');
});
