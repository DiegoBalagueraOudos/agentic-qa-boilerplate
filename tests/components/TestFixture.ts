/**
 * KATA Architecture - Layer 4: Unified Test Fixture
 *
 * Main entry point for all test types (E2E, Integration).
 * Combines API and UI fixtures for seamless hybrid testing.
 *
 * This file extends Playwright's test with custom fixtures that provide:
 * - `test`: Full fixture with both UI and API (for E2E tests)
 * - `ui`: UI-only fixture (for E2E tests)
 * - `api`: API-only fixture (for integration tests)
 *
 * IMPORTANT: All fixtures share the same context from TestContext.
 * This ensures that UI and API operations use the same Playwright drivers,
 * maintaining consistency across hybrid tests.
 *
 * Usage in E2E tests:
 *   test('example', async ({ ui }) => {
 *     await ui.login.goto();
 *     await ui.login.loginAsAdminSuccessfully(credentials);
 *   });
 *
 * Usage in API-only tests (the encrypted session comes from api-setup):
 *   test('example', async ({ api }) => {
 *     await api.auth.verifySessionAuthorized();
 *   });
 */

import type { APIRequestContext, Page } from '@playwright/test';
import type { CryptoSessionState } from '@utils/cryptoSession';
import type { Environment } from '@variables';

import { existsSync, readFileSync } from 'node:fs';

import { ApiFixture } from '@ApiFixture';
import { test as base, expect } from '@playwright/test';
import { TestContext } from '@TestContext';
import { UiFixture } from '@UiFixture';
import { config, env } from '@variables';
import { label } from 'allure-js-commons';

// ============================================
// Crypto session persisted by api-setup (ADR-0018)
// ============================================

/**
 * Read the crypto session `api-setup` wrote to `.auth/crypto-session.json`.
 * Null when the file is absent or unreadable: the first secure call then fails
 * by name ("No crypto session"), which is the right place to find out.
 */
function readCryptoSession(): CryptoSessionState | null {
  const path = config.auth.cryptoSessionPath;
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CryptoSessionState;
  }
  catch {
    return null;
  }
}

/**
 * Read the SPA's UI session metadata `ui-setup` saved (raw JSON string, no
 * tokens). Null when absent: the SPA then starts signed out.
 */
function readUiSession(): string | null {
  const path = config.auth.uiSessionPath;
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

// ============================================
// E2E Fixture (Page + API)
// ============================================

class TestFixture extends TestContext {
  /** API fixture - for making HTTP requests */
  api: ApiFixture;

  /** UI fixture - for browser interactions */
  ui: UiFixture;

  constructor(page: Page, request: APIRequestContext, environment?: Environment) {
    // Pass both drivers to TestContext
    super({ page, request, environment });

    // Create fixtures with the same options (shared context)
    const options = { page, request, environment: this.env };
    this.api = new ApiFixture(options);
    this.ui = new UiFixture(options);

    // Hybrid tests ride the browser's cookies (page.request); the crypto session
    // is the API half only, so it is optional here.
    const session = readCryptoSession();
    if (session) {
      this.api.setCryptoSession(session);
    }
  }

  /**
   * Set auth token for API requests.
   * Use this to refresh token during tests (e.g., after re-login).
   */
  setAuthToken(token: string): void {
    this.api.setAuthToken(token);
  }

  /**
   * Clear auth token.
   * Use this to test unauthenticated scenarios.
   */
  clearAuthToken(): void {
    this.api.clearAuthToken();
  }

  /**
   * Direct access to Playwright Page instance.
   * Convenience getter for E2E tests that need direct page access.
   */
  get page(): Page {
    if (!this._page) {
      throw new Error('Page is not available.');
    }
    return this._page;
  }
}

// ============================================
// Playwright Test Extensions
// ============================================

/**
 * Extended Playwright test with KATA fixtures
 *
 * Fixtures provided:
 * - test: Full fixture with both UI and API (for E2E tests)
 * - ui: UI-only fixture (for UI-focused tests)
 * - api: API-only fixture (for integration tests - NO browser opened)
 *
 * IMPORTANT: Playwright fixtures are LAZY.
 * - If you only use `api`, NO browser is opened
 * - If you use `ui` or `test`, the browser is opened
 */
export const test = base.extend<{
  test: TestFixture
  api: ApiFixture
  ui: UiFixture
  _allureLayer: void
}>({
  // Auto-fixture: labels every test with its test layer (derived from the
  // spec path) so Allure dashboard charts (testing pyramid, durations by
  // layer) can group results without per-test boilerplate.
  _allureLayer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const file = testInfo.file.replace(/\\/g, '/');
      const layer = file.includes('/integration/')
        ? 'integration'
        : file.includes('/e2e/') ? 'e2e' : undefined;
      if (layer) {
        await label('layer', layer);
      }
      await use();
    },
    { auto: true },
  ],

  // Restores the SPA's sessionStorage metadata that storageState cannot carry
  // (see ui-auth.setup.ts). Only when this context holds the session cookie, so a
  // spec that starts signed out (`storageState: empty`, the login cases) stays
  // signed out. Limitation: a hard reload after an in-test logout restores it again.
  page: async ({ page, context }, use) => {
    const uiSession = readUiSession();
    const hasSessionCookie = (await context.cookies()).some(c => c.name === 'access_token');
    if (uiSession !== null && hasSessionCookie) {
      await context.addInitScript(([key, value]) => {
        if (sessionStorage.getItem(key) === null) {
          sessionStorage.setItem(key, value);
        }
      }, [config.auth.uiSessionKey, uiSession] as const);
    }
    await use(page);
  },

  // Full test fixture with UI + API (for E2E tests)
  test: async ({ page, request }, use) => {
    const fixture = new TestFixture(page, request);
    await use(fixture);
  },

  // UI-only fixture (opens browser)
  ui: async ({ page, request }, use) => {
    const uiFixture = new UiFixture({ page, request });
    await use(uiFixture);
  },

  // API-only fixture (NO browser opened - Playwright fixtures are lazy)
  api: async ({ request }, use) => {
    const apiFixture = new ApiFixture({ request });

    // The cookies arrive with the project's storageState (.auth/api-session.json);
    // the session id and AES key come from .auth/crypto-session.json.
    const session = readCryptoSession();
    if (session) {
      apiFixture.setCryptoSession(session);
    }

    await use(apiFixture);
  },
});

// ============================================
// Re-exports
// ============================================

export { ApiFixture, config, env, expect, TestFixture, UiFixture };
export type { Environment };
