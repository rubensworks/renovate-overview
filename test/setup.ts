/**
 * A Web Storage implementation the suite fully controls.
 *
 * Vitest's jsdom environment copies jsdom's globals onto the Node global, but skips any name the
 * host already defines. Node 26 ships its own `localStorage`, which is undefined unless the process
 * was started with `--localstorage-file`, so jsdom's is skipped and every storage call in the suite
 * hits undefined. Installing our own here makes the suite behave the same on every Node version,
 * and gives `Storage.prototype` a real prototype for tests that need storage to misbehave.
 */
class MemoryStorage {
  private readonly entries = new Map<string, string>();

  public get length(): number {
    return this.entries.size;
  }

  public key(index: number): string | null {
    return [ ...this.entries.keys() ][index] ?? null;
  }

  public getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  public removeItem(key: string): void {
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }
}

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

define('Storage', MemoryStorage);
define('localStorage', new MemoryStorage());
define('sessionStorage', new MemoryStorage());
