import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  clearOwnerTokens,
  clearToken,
  loadOwnerTokens,
  loadSettings,
  loadToken,
  saveOwnerTokens,
  saveSettings,
  saveToken,
  tokenLocation,
} from '../src/lib/storage';
import type { ISettings } from '../src/lib/types';

const TOKEN_KEY = 'renovate-overview:token';
const OWNER_TOKENS_KEY = 'renovate-overview:owner-tokens';
const SETTINGS_KEY = 'renovate-overview:settings';

const CUSTOM: ISettings = {
  orgs: [ 'comunica' ],
  extraAuthors: [ 'my-renovate' ],
  includeDependabot: true,
  writeActions: true,
  theme: 'light',
};

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('loadToken', () => {
  it('returns undefined when nothing is stored', () => {
    expect(loadToken()).toBeUndefined();
  });

  it('prefers the session token over the remembered one', () => {
    sessionStorage.setItem(TOKEN_KEY, 'session');
    localStorage.setItem(TOKEN_KEY, 'local');
    expect(loadToken()).toEqual({ token: 'session', remembered: false });
  });

  it('falls back to the remembered token', () => {
    localStorage.setItem(TOKEN_KEY, 'local');
    expect(loadToken()).toEqual({ token: 'local', remembered: true });
  });

  it('ignores empty entries in either storage', () => {
    sessionStorage.setItem(TOKEN_KEY, '');
    localStorage.setItem(TOKEN_KEY, '');
    expect(loadToken()).toBeUndefined();
  });

  it('survives storage that refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadToken()).toBeUndefined();
  });
});

describe('tokenLocation', () => {
  it('reports where the token lives', () => {
    expect(tokenLocation()).toBe('none');
    saveToken('t', true);
    expect(tokenLocation()).toBe('local');
    saveToken('t', false);
    expect(tokenLocation()).toBe('session');
  });
});

describe('saveToken', () => {
  it('remembers a token in local storage', () => {
    saveToken('secret', true);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('secret');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('keeps a token for the tab only', () => {
    saveToken('secret', false);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('secret');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('drops the previous token when moving between storages', () => {
    saveToken('first', true);
    saveToken('second', false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('second');
  });

  it('survives storage that refuses to be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => saveToken('secret', true)).not.toThrow();
  });
});

describe('clearToken', () => {
  it('wipes both storages', () => {
    localStorage.setItem(TOKEN_KEY, 'a');
    sessionStorage.setItem(TOKEN_KEY, 'b');
    clearToken();
    expect(loadToken()).toBeUndefined();
  });

  it('survives storage that refuses to be cleared', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearToken()).not.toThrow();
  });
});

describe('loadOwnerTokens', () => {
  it('returns nothing when none are stored', () => {
    expect(loadOwnerTokens()).toEqual([]);
  });

  it('prefers session storage', () => {
    sessionStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'a', token: 'x' }]));
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'b', token: 'y' }]));
    expect(loadOwnerTokens()).toEqual([{ owner: 'a', token: 'x' }]);
  });

  it('falls back to local storage', () => {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'b', token: 'y' }]));
    expect(loadOwnerTokens()).toEqual([{ owner: 'b', token: 'y' }]);
  });

  it('ignores unparseable JSON', () => {
    localStorage.setItem(OWNER_TOKENS_KEY, '{oops');
    expect(loadOwnerTokens()).toEqual([]);
  });

  it('ignores a stored value that is not a list', () => {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify({ owner: 'a' }));
    expect(loadOwnerTokens()).toEqual([]);
  });

  it('drops malformed entries', () => {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([
      { owner: 'good', token: 'x' },
      { owner: '', token: 'x' },
      { owner: 'a', token: '' },
      { owner: 1, token: 'x' },
      { owner: 'a', token: 2 },
      null,
      'nope',
    ]));
    expect(loadOwnerTokens()).toEqual([{ owner: 'good', token: 'x' }]);
  });
});

describe('saveOwnerTokens', () => {
  it('remembers tokens beside the main one', () => {
    saveOwnerTokens([{ owner: 'comunica', token: 'x' }], true);
    expect(loadOwnerTokens()).toEqual([{ owner: 'comunica', token: 'x' }]);
    expect(localStorage.getItem(OWNER_TOKENS_KEY)).not.toBeNull();
  });

  it('keeps tokens for the tab only', () => {
    saveOwnerTokens([{ owner: 'comunica', token: 'x' }], false);
    expect(sessionStorage.getItem(OWNER_TOKENS_KEY)).not.toBeNull();
    expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
  });

  it('clears the entry when given an empty list', () => {
    saveOwnerTokens([{ owner: 'comunica', token: 'x' }], true);
    saveOwnerTokens([], true);
    expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
    expect(loadOwnerTokens()).toEqual([]);
  });
});

describe('clearOwnerTokens', () => {
  it('wipes both storages', () => {
    saveOwnerTokens([{ owner: 'comunica', token: 'x' }], true);
    clearOwnerTokens();
    expect(loadOwnerTokens()).toEqual([]);
  });
});

describe('loadSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults to read-only', () => {
    expect(DEFAULT_SETTINGS.writeActions).toBe(false);
  });

  it('round-trips saved settings', () => {
    saveSettings(CUSTOM);
    expect(loadSettings()).toEqual(CUSTOM);
  });

  it('returns the defaults for unparseable JSON', () => {
    localStorage.setItem(SETTINGS_KEY, '{oops');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults for a non-object', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify('nope'));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults for a stored null', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(null));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back per field when values are the wrong type', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      orgs: 'comunica',
      extraAuthors: 3,
      includeDependabot: 'yes',
      theme: 'neon',
    }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps only the string entries of the list fields', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ orgs: [ 'comunica', 7 ], extraAuthors: [ 1, 'bot' ]}));
    expect(loadSettings().orgs).toEqual([ 'comunica' ]);
    expect(loadSettings().extraAuthors).toEqual([ 'bot' ]);
  });

  it('never enables write actions on anything but an explicit true', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ writeActions: 'true' }));
    expect(loadSettings().writeActions).toBe(false);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ writeActions: 1 }));
    expect(loadSettings().writeActions).toBe(false);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ writeActions: true }));
    expect(loadSettings().writeActions).toBe(true);
  });

  it('accepts every theme it knows', () => {
    for (const theme of <const> [ 'auto', 'dark', 'light' ]) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme }));
      expect(loadSettings().theme).toBe(theme);
    }
  });
});
