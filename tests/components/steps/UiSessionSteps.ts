/**
 * KATA Architecture - Layer 3: Steps - Signed-in UI session
 *
 * Reusable chains shared by the shell, session and role specs: open the login
 * page, sign in through the real form (Administrator, or a tenant user: UserApp
 * or TenantAdmin), wait for the role's landing, and sign out again so the server
 * session of a real account never stays open.
 * Undecorated and instantiated directly (`new UiSessionSteps({ page })`), not a
 * fixture: the credentials must never reach a step title, and a component must
 * not depend on another component (the chain lives here instead).
 *
 * The credentials come as a flat object (`username`, `password`); nothing here
 * carries a token or a cookie.
 */

import type { TestContextOptions } from '@TestContext';
import type { LoginCredentials } from '@ui/LoginPage';

import { expect, test } from '@playwright/test';
import { TestContext } from '@TestContext';
import { LoginPage } from '@ui/LoginPage';

export interface SignInOptions {
  /** Install Playwright's fake clock BEFORE the SPA boots (inactivity timers). */
  fakeClock?: boolean
}

export class UiSessionSteps extends TestContext {
  private readonly login: LoginPage;

  constructor(options: TestContextOptions) {
    super(options);
    this.login = new LoginPage(options);
  }

  private get page() {
    if (!this._page) {
      throw new Error('UiSessionSteps needs a Playwright page');
    }
    return this._page;
  }

  /**
   * Sign in as Administrator through the real form and wait for a live
   * dashboard (route AND heading).
   */
  async signInAndReachDashboard(credentials: LoginCredentials, options: SignInOptions = {}): Promise<void> {
    if (options.fakeClock) {
      await this.page.clock.install();
    }
    await this.login.goto();
    await this.login.signInAsAdmin(credentials);
    await expect(this.page).toHaveURL(/\/dashboard$/);
    await expect(this.login.dashboardHeading).toBeVisible();
  }

  /**
   * Sign in through the tenant-user form (UserApp or TenantAdmin) and wait for
   * the role's landing route. Positive logins only.
   */
  async signInAsTenantUserAndReachLanding(credentials: LoginCredentials, landing: RegExp): Promise<void> {
    await this.login.goto();
    await this.login.signInAsTenantUser(credentials);
    await expect(this.page).toHaveURL(landing);
  }

  /**
   * Sign out through the shell and prove the server session was closed: the
   * logout call answers 200 and the user lands on /login. Called from a spec
   * `finally`: with `bodyPassed: false` a sign-out failure is only annotated
   * (`signout-failed`) so it never masks the body's own error.
   */
  async signOut(bodyPassed = true): Promise<void> {
    const timeout = bodyPassed ? undefined : 5000;
    try {
      const [response] = await Promise.all([
        this.page.waitForResponse(
          r => r.request().method() === 'POST' && /\/api\/auth\/logout/i.test(r.url()),
          { timeout },
        ),
        this.page.getByRole('button', { name: 'Cerrar sesión' }).click({ timeout }),
      ]);
      expect(response.status(), 'the logout call closes the server session').toBe(200);
      await expect(this.page).toHaveURL(/\/login$/, { timeout });
    }
    catch (error) {
      if (bodyPassed) {
        throw error;
      }
      const firstLine = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0].slice(0, 200);
      test.info().annotations.push({ type: 'signout-failed', description: firstLine });
    }
  }
}
