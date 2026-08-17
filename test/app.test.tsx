import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app';

describe('App', () => {
  it('renders the application shell', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Renovate Overview' })).toBeDefined();
  });
});
