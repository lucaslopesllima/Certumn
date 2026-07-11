// Ponto único de import pros specs: `import { test, expect } from '../../fixtures'`.
// Junta a fixture de auth (loginAs/session) com o mock automático de tiles OSM.
import { mergeTests } from '@playwright/test';
import { test as authTest } from './auth.ts';
import { test as mocksTest } from './external-mocks.ts';

export const test = mergeTests(authTest, mocksTest);
export { expect } from '@playwright/test';
export {
  registerOrg, login, setSession, loginAs, createMember, loginWithoutPermission, uniqTag, uniqEmail,
  type Session, type SessionUser,
} from './auth.ts';
export { ApiClient } from './api.ts';
export * as db from './db.ts';
