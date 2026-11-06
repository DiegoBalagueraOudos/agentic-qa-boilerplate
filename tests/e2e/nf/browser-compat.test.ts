/**
 * NF-04: the same Administrator walk in Chrome (Chromium), Edge and Firefox.
 *
 * The spec launches the three browsers itself (Edge through its installed channel) and signs the real Administrator in each one
 * through the form, positive logins only, closing every session at the end. A GENERATED tenant is created in `beforeAll` and removed
 * in `afterAll`. Empty storage state and trace off at file level: the browsers hold live sessions.
 */

import type { Browser } from '@playwright/test';
import type { UiTenant } from '@steps/UiTenantSteps';
import type { CompatBrowser } from '@ui/CompatPage';

import { chromium, firefox } from '@playwright/test';
import { UiSessionSteps } from '@steps/UiSessionSteps';
import { UiTenantSteps } from '@steps/UiTenantSteps';
import { test } from '@TestFixture';
import { config } from '@variables';

test.use({ storageState: { cookies: [], origins: [] } });
test.use({ trace: 'off' });

test.describe('Non-functional: browser compatibility', () => {
  const tenants = new UiTenantSteps();
  let tenant: UiTenant;

  test.beforeAll(async () => {
    test.setTimeout(120000);
    try {
      tenant = await tenants.prepareTenant();
    }
    catch (error) {
      await tenants.cleanup().catch(() => undefined);
      throw error;
    }
  });

  test.afterAll(async () => {
    await tenants.cleanup();
  });

  test('NF-04: should give the same result in Chrome, Edge and Firefox', async ({ ui }) => {
    test.setTimeout(300000);
    const launchers: Array<{ label: string, launch: () => Promise<Browser> }> = [
      { label: 'Chrome', launch: async () => chromium.launch({ headless: config.browser.headless }) },
      { label: 'Edge', launch: async () => chromium.launch({ channel: 'msedge', headless: config.browser.headless }) },
      { label: 'Firefox', launch: async () => firefox.launch({ headless: config.browser.headless }) },
    ];
    const opened: Browser[] = [];
    try {
      const browsers: CompatBrowser[] = [];
      for (const { label, launch } of launchers) {
        const browser = await launch();
        opened.push(browser);
        const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'es-CO', viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        const session = new UiSessionSteps({ page });
        browsers.push({
          label,
          page,
          signIn: async () => session.signInAndReachDashboard({ username: config.testUser.email, password: config.testUser.password }),
        });
      }
      await ui.compat.showSameResultInEveryBrowser({ browsers, tenant });
    }
    finally {
      for (const browser of opened) {
        await browser.close().catch(() => undefined);
      }
    }
  });
});
