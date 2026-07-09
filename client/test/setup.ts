import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { api } from '../src/lib/api.ts';

afterEach(() => {
  cleanup();
  localStorage.clear();
  // cache de GET do api.ts é module-level — sem isso, resposta de um teste vaza pro seguinte
  api.invalidate();
});
