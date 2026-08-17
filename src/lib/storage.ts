import type { IOwnerToken, ISettings, MergeMethod, Theme, TokenLocation } from './types';

const TOKEN_KEY = 'renovate-overview:token';
const OWNER_TOKENS_KEY = 'renovate-overview:owner-tokens';
const SETTINGS_KEY = 'renovate-overview:settings';

export const DEFAULT_SETTINGS: ISettings = {
  orgs: [],
  extraAuthors: [],
  includeDependabot: false,
  // Write actions stay off until asked for, so a read-only token is never met with dead buttons.
  writeActions: false,
  mergeMethod: 'squash',
  repoMergeMethods: {},
  theme: 'auto',
};

// Storage access throws in some privacy modes, so every access is guarded.
function safeRead(storage: Storage, key: string): string | undefined {
  try {
    return storage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function safeWrite(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Nothing sensible to do when storage is unavailable or full; the app keeps working in memory.
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // See safeWrite.
  }
}

export interface IStoredToken {
  token: string;
  remembered: boolean;
}

/**
 * Reads the personal access token from session storage first, then from local storage.
 */
export function loadToken(): IStoredToken | undefined {
  const sessionToken = safeRead(sessionStorage, TOKEN_KEY);
  if (sessionToken !== undefined && sessionToken.length > 0) {
    return { token: sessionToken, remembered: false };
  }
  const localToken = safeRead(localStorage, TOKEN_KEY);
  if (localToken !== undefined && localToken.length > 0) {
    return { token: localToken, remembered: true };
  }
  return undefined;
}

/**
 * Reports where the token currently lives, so the settings can say so.
 */
export function tokenLocation(): TokenLocation {
  const stored = loadToken();
  if (stored === undefined) {
    return 'none';
  }
  return stored.remembered ? 'local' : 'session';
}

/**
 * Persists the token, either for this browser or only for this tab session.
 * @param token A GitHub personal access token.
 * @param remember Whether to keep the token in local storage across browser restarts.
 */
export function saveToken(token: string, remember: boolean): void {
  clearToken();
  safeWrite(remember ? localStorage : sessionStorage, TOKEN_KEY, token);
}

/**
 * Removes the token from both storages.
 */
export function clearToken(): void {
  safeRemove(localStorage, TOKEN_KEY);
  safeRemove(sessionStorage, TOKEN_KEY);
}

function parseOwnerTokens(raw: string | undefined): IOwnerToken[] {
  if (raw === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = <unknown> JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((entry): entry is IOwnerToken =>
    typeof entry === 'object' && entry !== null &&
    typeof (<IOwnerToken> entry).owner === 'string' && (<IOwnerToken> entry).owner.length > 0 &&
    typeof (<IOwnerToken> entry).token === 'string' && (<IOwnerToken> entry).token.length > 0);
}

/**
 * Reads the per-owner tokens, session storage first, exactly like the main token.
 */
export function loadOwnerTokens(): IOwnerToken[] {
  const fromSession = parseOwnerTokens(safeRead(sessionStorage, OWNER_TOKENS_KEY));
  return fromSession.length > 0 ? fromSession : parseOwnerTokens(safeRead(localStorage, OWNER_TOKENS_KEY));
}

/**
 * Persists the per-owner tokens beside the main one.
 * @param tokens The tokens to store. An empty list clears them.
 * @param remember Whether to keep them across browser restarts.
 */
export function saveOwnerTokens(tokens: IOwnerToken[], remember: boolean): void {
  clearOwnerTokens();
  if (tokens.length > 0) {
    safeWrite(remember ? localStorage : sessionStorage, OWNER_TOKENS_KEY, JSON.stringify(tokens));
  }
}

/**
 * Removes every per-owner token from both storages.
 */
export function clearOwnerTokens(): void {
  safeRemove(localStorage, OWNER_TOKENS_KEY);
  safeRemove(sessionStorage, OWNER_TOKENS_KEY);
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function toMergeMethod(value: unknown): MergeMethod | undefined {
  return value === 'merge' || value === 'squash' || value === 'rebase' ? value : undefined;
}

function toMergeMethods(value: unknown): Record<string, MergeMethod> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const methods: Record<string, MergeMethod> = {};
  for (const [ repo, method ] of Object.entries(<Record<string, unknown>> value)) {
    const parsed = toMergeMethod(method);
    if (parsed !== undefined) {
      methods[repo] = parsed;
    }
  }
  return methods;
}

function toTheme(value: unknown): Theme | undefined {
  return value === 'auto' || value === 'dark' || value === 'light' ? value : undefined;
}

/**
 * Reads the persisted settings, falling back to the defaults for anything missing or malformed.
 */
export function loadSettings(): ISettings {
  const raw = safeRead(localStorage, SETTINGS_KEY);
  if (raw === undefined) {
    return DEFAULT_SETTINGS;
  }
  let parsed: unknown;
  try {
    parsed = <unknown> JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return DEFAULT_SETTINGS;
  }
  const record = <Record<string, unknown>> parsed;
  return {
    orgs: toStringArray(record.orgs) ?? DEFAULT_SETTINGS.orgs,
    extraAuthors: toStringArray(record.extraAuthors) ?? DEFAULT_SETTINGS.extraAuthors,
    includeDependabot: record.includeDependabot === true,
    // Anything other than an explicit `true` leaves the app read-only, so a corrupted or
    // hand-edited settings blob can never switch the write actions on by accident.
    writeActions: record.writeActions === true,
    mergeMethod: toMergeMethod(record.mergeMethod) ?? DEFAULT_SETTINGS.mergeMethod,
    repoMergeMethods: toMergeMethods(record.repoMergeMethods) ?? DEFAULT_SETTINGS.repoMergeMethods,
    theme: toTheme(record.theme) ?? DEFAULT_SETTINGS.theme,
  };
}

/**
 * Persists the settings.
 * @param settings The settings to store.
 */
export function saveSettings(settings: ISettings): void {
  safeWrite(localStorage, SETTINGS_KEY, JSON.stringify(settings));
}
