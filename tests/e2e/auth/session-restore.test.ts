/**
 * Session reuse check for the UI.
 *
 * Maps to no case: it proves `ui-setup` saved a storage state and Playwright
 * loaded it, which every other e2e spec silently depends on.
 */

import { expect, test } from '@TestFixture';

// File-level trace off: the restored session cookies must not be recorded in a trace.
test.use({ trace: 'off' });

test.describe('SETUP: UI session', { tag: ['@critical'] }, () => {
  // Raw `page`, deliberately, and the ONLY place in this repo where that is
  // right. This asserts INFRASTRUCTURE (a saved session was restored), not a
  // domain flow, so there is no Page component to route through.
  test('SETUP: should open the dashboard without signing in again', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Resumen del sistema multitenant')).toBeVisible();
  });
});
