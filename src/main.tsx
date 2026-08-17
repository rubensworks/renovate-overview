import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const container = document.querySelector('#root');
if (container === null) {
  throw new Error('Missing #root container');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
