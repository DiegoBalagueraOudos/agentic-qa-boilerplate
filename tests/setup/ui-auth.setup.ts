/**
 * KATA Architecture - UI Auth Setup
 *
 * Signs in through the real SPA login (ADR-0018): the SPA performs the ECDH
 * handshake, encrypts the credentials and receives the HttpOnly session
 * cookies and the CSRF cookie. Nothing here replays or short-cuts that.
 *
 * Saves the browser storage state (cookies + localStorage) for the UI tests.
 * The API half has its own setup (api-auth.setup.ts) and its own session.
 *
 * Dependencies: global-setup
 * Dependents: e2e
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test as setup } from '@TestFixture';
import { config } from '@variables';

// File-level trace off: the trace records the arguments of fill/evaluate, which carry a real credential.
setup.use({ trace: 'off' });

const storageStateFile = config.auth.storageStatePath;

/**
 * UI Authentication Setup
 *
 * 1. LoginPage.goto() opens /login on the mode selector
 * 2. LoginPage.loginAsAdminSuccessfully() picks the admin mode, signs in, and
 *    asserts the dashboard and the HttpOnly session cookie (AUT-002)
 * 3. Saves storageState for the e2e and smoke-ui projects
 */
setup('UI Setup: authenticate via UI', async ({ ui, page }) => {
  console.log('[UI Setup] Starting UI authentication...');

  await ui.login.goto();
  await ui.login.loginAsAdminSuccessfully({
    username: config.testUser.email,
    password: config.testUser.password,
  });
  console.log('[UI Setup] UI login successful');

  await page.context().storageState({ path: storageStateFile });
  console.log(`[UI Setup] Storage state saved to ${storageStateFile}`);

  // Cookie NAMES only: the values are the session
  const saved = JSON.parse(readFileSync(storageStateFile, 'utf-8')) as { cookies: { name: string }[] };
  expect(saved.cookies.map(c => c.name)).toContain('access_token');

  // storageState does not carry sessionStorage, where the SPA keeps its UI session
  // metadata. Without it a restored browser has the cookies but the SPA treats the
  // user as signed out. The `page` fixture in TestFixture.ts puts it back.
  const uiSession = await page.evaluate(key => sessionStorage.getItem(key), config.auth.uiSessionKey);
  expect(uiSession).not.toBeNull();
  writeFileSync(config.auth.uiSessionPath, uiSession as string);
  console.log(`[UI Setup] UI session metadata saved to ${config.auth.uiSessionPath}`);
});
