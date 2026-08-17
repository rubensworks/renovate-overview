import { describe, expect, it } from 'vitest';
import { captured } from '../../src/lib/renovate/capture';

function matchOf(pattern: RegExp, input: string): RegExpExecArray {
  const match = pattern.exec(input);
  if (match === null) {
    throw new Error(`Fixture pattern ${pattern.source} did not match ${input}`);
  }
  return match;
}

describe('captured', () => {
  it('returns the text of a group that matched', () => {
    expect(captured(matchOf(/v(\d+)\.(\d+)/u, 'v4.17'), 1)).toBe('4');
    expect(captured(matchOf(/v(\d+)\.(\d+)/u, 'v4.17'), 2)).toBe('17');
  });

  it('returns nothing for a group that matched nothing', () => {
    expect(captured(matchOf(/a(b)?/u, 'a'), 1)).toBe('');
  });
});
