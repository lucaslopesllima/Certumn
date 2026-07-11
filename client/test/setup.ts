import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { api } from '../src/lib/api.ts';

afterEach(() => {
  cleanup();
  localStorage.clear();
  // Higiene entre testes: um teste que ligou fake timers e não restaurou faria
  // o waitFor do seguinte (às vezes de outro arquivo, no mesmo worker) travar.
  vi.useRealTimers();
  // cache de GET do api.ts é module-level — sem isso, resposta de um teste vaza pro seguinte
  api.invalidate();
});
