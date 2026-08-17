import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { renderMock, createRootMock } = vi.hoisted(() => {
  const renderMock = vi.fn();
  return { renderMock, createRootMock: vi.fn(() => ({ render: renderMock })) };
});

vi.mock('react-dom/client', () => ({ createRoot: createRootMock }));

// The app itself is covered elsewhere; the entry point only has to mount something.
vi.mock('../src/app', () => ({ App: () => null }));

beforeEach(() => {
  vi.resetModules();
  renderMock.mockClear();
  createRootMock.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('main', () => {
  it('mounts the app into the #root container', async() => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    await import('../src/main');

    expect(createRootMock).toHaveBeenCalledWith(root);
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the container is missing', async() => {
    await expect(import('../src/main')).rejects.toThrow('Missing #root container');
    expect(createRootMock).not.toHaveBeenCalled();
  });
});
