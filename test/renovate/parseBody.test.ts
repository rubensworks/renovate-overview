import { describe, expect, it } from 'vitest';
import { parseBody } from '../../src/lib/renovate/parseBody';
import {
  ACTION_DIGEST_BODY,
  DEFAULT_BODY,
  DEPENDABOT_BODY,
  EMPTY_ROWS_BODY,
  GROUP_BODY,
  LEADING_OTHER_TABLE_BODY,
  ONE_SIDED_CHANGE_BODY,
  NO_TABLE_BODY,
  RELEASE_NOTES_BODY,
  SHORT_ROW_BODY,
  REORDERED_BODY,
  SPLIT_VERSION_BODY,
} from './bodies';

describe('parseBody', () => {
  it('reads the default Package/Type/Update/Change layout', () => {
    expect(parseBody(DEFAULT_BODY).updates).toEqual([{
      depName: '@sentry/cli',
      groupKey: 'sentry-cli',
      currentVersion: '1.53.0',
      newVersion: '1.54.0',
      updateType: 'minor',
      depType: 'dependencies',
      manager: undefined,
      source: 'body',
    }]);
  });

  it('reads columns by header name, not by position', () => {
    const [ update ] = parseBody(REORDERED_BODY).updates;
    expect(update?.depName).toBe('lodash');
    expect(update?.updateType).toBe('major');
    expect(update?.currentVersion).toBe('4.17.20');
    expect(update?.newVersion).toBe('5.0.0');
    expect(update?.depType).toBeUndefined();
  });

  it('reads separate current-value and new-value columns', () => {
    const [ update ] = parseBody(SPLIT_VERSION_BODY).updates;
    expect(update?.currentVersion).toBe('5.3.3');
    expect(update?.newVersion).toBe('5.4.2');
    expect(update?.manager).toBe('npm');
  });

  it('reads every package of a group, which no title could tell us', () => {
    const parsed = parseBody(GROUP_BODY);
    expect(parsed.updates).toHaveLength(8);
    expect(parsed.isGroupPr).toBe(true);
    expect(parsed.updates.map(update => update.depName)).toEqual([
      '@babel/core',
      '@babel/preset-env',
      '@types/node',
      'eslint',
      'jest',
      'lodash',
      'typescript',
      'vite',
    ]);
    expect(parsed.updates.map(update => update.groupKey)).toContain('types-node');
  });

  it('does not call a single-package table a group', () => {
    expect(parseBody(DEFAULT_BODY).isGroupPr).toBe(false);
  });

  it('reads a digest row', () => {
    const [ update ] = parseBody(ACTION_DIGEST_BODY).updates;
    expect(update?.updateType).toBe('digest');
    expect(update?.currentVersion).toBe('a1b2c3d');
    expect(update?.newVersion).toBe('e4f5a6b');
    expect(update?.depType).toBe('action');
  });

  it('stops at the first table, ignoring the ones inside release notes', () => {
    const parsed = parseBody(RELEASE_NOTES_BODY);
    expect(parsed.updates).toHaveLength(1);
    expect(parsed.updates[0]?.depName).toBe('vite');
  });

  it('skips a table that has no package column, however early it comes', () => {
    const parsed = parseBody(LEADING_OTHER_TABLE_BODY);
    expect(parsed.updates.map(update => update.depName)).toEqual([ 'vite' ]);
  });

  it('reads no versions from a change cell that is not an arrow between two', () => {
    const [ update ] = parseBody(ONE_SIDED_CHANGE_BODY).updates;
    expect(update?.depName).toBe('lodash');
    expect(update?.currentVersion).toBeUndefined();
    expect(update?.newVersion).toBeUndefined();
  });

  it('keeps a row whose trailing cells are missing entirely', () => {
    const [ update ] = parseBody(SHORT_ROW_BODY).updates;
    expect(update?.depName).toBe('lodash');
    expect(update?.depType).toBe('dependencies');
    expect(update?.updateType).toBe('unknown');
    expect(update?.newVersion).toBeUndefined();
  });

  it('finds nothing in a body with no table', () => {
    expect(parseBody(NO_TABLE_BODY).updates).toEqual([]);
  });

  it('finds nothing in a body that is prose', () => {
    expect(parseBody(DEPENDABOT_BODY).updates).toEqual([]);
  });

  it('drops rows whose package cell is empty', () => {
    expect(parseBody(EMPTY_ROWS_BODY).updates).toEqual([]);
  });

  it('copes with an empty body', () => {
    expect(parseBody('').updates).toEqual([]);
  });

  it('strips the Renovate marker comments before reading anything', () => {
    const body = [
      '<!--renovate-config-hash:abc123-->',
      '| Package | Update |',
      '|---|---|',
      '| lodash | patch |',
      '<!-- rebase-check -->',
      '<!--renovate-debug:eyJ9-->',
    ].join('\n');
    expect(parseBody(body).updates.map(update => update.depName)).toEqual([ 'lodash' ]);
  });

  it('marks everything it produces as coming from the body', () => {
    for (const update of parseBody(GROUP_BODY).updates) {
      expect(update.source).toBe('body');
    }
  });
});
