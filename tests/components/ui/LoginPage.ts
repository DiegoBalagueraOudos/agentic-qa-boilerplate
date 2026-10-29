/**
 * KATA Architecture - Layer 3: Login Page Component
 *
 * UI component for the two-step login of the Validate SPA: first pick the mode
 * (system administrator or tenant user), then fill that mode's form. This
 * component covers both: the administrator mode (AUT-001..AUT-010, AUT-034) and
 * the tenant-user mode (AUT-004, AUT-008, AUT-012), plus the redirect of a
 * signed-in user away from /login (AUT-013).
 *
 * ATC ids are the local case ids under .context/QA/cases/ (no TMS in this project).
 *
 * Page: /login
 * The SPA exposes no data-testid. Locators use roles and the Angular
 * `formcontrolname` attribute, which is the form contract and does not move
 * with styling. Only one mode's form is rendered at a time.
 */

import type { Request, Response } from '@playwright/test';
import type { TestContextOptions } from '@TestContext';

import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc, step } from '@utils/decorators';
import { config } from '@variables';

// ============================================
// Types - Login data structures
// ============================================

/**
 * The admin form asks for "Usuario", not an email: the backend field is `UserName`.
 */
export interface LoginCredentials {
  username: string
  password: string
}

// ============================================
// Login Page Component
// ============================================

export class LoginPage extends UiBase {
  constructor(options: TestContextOptions) {
    super(options);
  }

  // ============================================
  // Locators (reused across ATCs)
  // ============================================

  private get adminModeButton() {
    return this.page.getByRole('button', { name: /Administrador del sistema/ });
  }

  private get tenantModeButton() {
    return this.page.getByRole('button', { name: /Usuario de tenant/ });
  }

  private get usernameInput() {
    return this.page.locator('input[formcontrolname="username"]');
  }

  private get passwordInput() {
    return this.page.locator('input[formcontrolname="password"]');
  }

  private get submitButton() {
    return this.page.getByRole('button', { name: 'Iniciar sesión' });
  }

  private get wrongCredentialsMessage() {
    return this.page.getByText('Credenciales incorrectas. Verifica tu usuario y contraseña.');
  }

  private get accountLockedMessage() {
    return this.page.getByText(/Cuenta bloqueada/);
  }

  private get repeatActionMessage() {
    return this.page.getByText('La sesión de cifrado expiró. Por favor, repite la acción.');
  }

  private get rateLimitNotice() {
    return this.page.getByText(/Demasiados intentos\. Intenta de nuevo en \d+\s?s/);
  }

  private get waitingButton() {
    return this.page.getByRole('button', { name: /Espera \d+\s?s/ });
  }

  /** Landing heading of the signed-in dashboard (also used by UiSessionSteps). */
  get dashboardHeading() {
    return this.page.getByText('Resumen del sistema multitenant');
  }

  /**
   * Error line under the form. Its text depends on the backend message (it differs
   * per rejection reason), so only its presence is asserted. Structural locator:
   * the SPA has no role or test id for it (`text-center text-red-600`, not the
   * per-field `mt-1 text-xs` validation lines).
   */
  private get formErrorMessage() {
    return this.page.locator('form p.text-center.text-red-600');
  }

  // ============================================
  // Helpers (Private)
  // ============================================

  private async selectTenantMode(): Promise<void> {
    await this.tenantModeButton.click();
    await expect(this.usernameInput).toBeVisible();
  }

  /**
   * Submit the form of the mode already selected with credentials that must be
   * rejected: the login call does not succeed, the SPA stays on /login with an
   * error visible, and no session cookie exists. The caller times the limiter
   * release with `watchRejectedLogins`, registered before the click.
   */
  private async submitRejectedLogin(credentials: LoginCredentials): Promise<void> {
    await this.fillAdminForm(credentials);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        r => r.request().method() === 'POST' && /\/api\/auth\/login\//i.test(r.url()),
      ),
      this.submitButton.click(),
    ]);

    expect(response.status(), 'a rejected login must not succeed').toBeGreaterThanOrEqual(400);
    await expect(this.formErrorMessage).toBeVisible();
    await expect(this.page).toHaveURL(/\/login$/);
    const cookies = await this.page.context().cookies();
    expect(cookies.map(c => c.name)).not.toContain('access_token');
  }

  /**
   * Record the time of the LAST rejected login call (status >= 400, 429
   * included) from a `response` listener that exists before the click, so it is
   * set even when a later assertion fails. The limiter window clears ~31 s after
   * that moment. Call `stop()` in `finally`.
   */
  private watchRejectedLogins(): { readonly lastAt: number | undefined, stop: () => void } {
    const state: { lastAt: number | undefined } = { lastAt: undefined };
    const onResponse = (response: Response) => {
      if (response.request().method() === 'POST' && /\/api\/auth\/login\//i.test(response.url()) && response.status() >= 400) {
        state.lastAt = Date.now();
      }
    };
    this.page.on('response', onResponse);
    return {
      get lastAt() {
        return state.lastAt;
      },
      stop: () => this.page.off('response', onResponse),
    };
  }

  /**
   * Wait until the address limiter window (4 failures in 30 s) is over, measured
   * from the LAST rejected login of the ATC, so the next test starts clean.
   * Condition-based (elapsed-time poll), never a fixed sleep. No-op when no
   * rejection was seen.
   */
  private async releaseLimiterWindow(lastRejectedAt: number | undefined): Promise<void> {
    if (lastRejectedAt === undefined) {
      return;
    }
    await expect.poll(() => Date.now() - lastRejectedAt, { timeout: 35000, intervals: [500] })
      .toBeGreaterThanOrEqual(31000);
  }

  /**
   * Release the limiter window at the end of an ATC without masking the body's
   * result: a body that passed turns a release failure into the failure; a body
   * that already failed keeps its own error and leaves a `release-failed` note.
   */
  private async releaseLimiterAfterBody(since: number | undefined, bodyPassed: boolean): Promise<void> {
    try {
      await this.releaseLimiterWindow(since);
    }
    catch (error) {
      if (bodyPassed) {
        throw error;
      }
      const firstLine = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0].slice(0, 200);
      test.info().annotations.push({ type: 'release-failed', description: firstLine });
    }
  }

  private async selectAdminMode(): Promise<void> {
    await this.adminModeButton.click();
    await expect(this.usernameInput).toBeVisible();
  }

  private async fillAdminForm(credentials: LoginCredentials): Promise<void> {
    await this.usernameInput.fill(credentials.username);
    await this.fillSecret(this.passwordInput, credentials.password);
  }

  /**
   * Remaining seconds shown by the rate-limit notice, or null while it is absent.
   */
  private async readNoticeSeconds(): Promise<number | null> {
    const text = await this.rateLimitNotice.first().textContent({ timeout: 1000 }).catch(() => null);
    const match = text?.match(/en (\d+)\s?s/);
    return match ? Number(match[1]) : null;
  }

  // ============================================
  // Navigation (Public)
  // ============================================

  /**
   * Navigate to the login page and wait for the mode selector.
   * Call this BEFORE using login ATCs.
   */
  @step
  async goto(): Promise<void> {
    await this.page.goto(this.buildUrl('/login'));
    await expect(this.adminModeButton).toBeVisible();
  }

  /**
   * Fill and submit the administrator form. Flat object so the step title masks
   * `password`. Does not wait for the outcome: the caller asserts it.
   */
  @step
  async signInAsAdmin(credentials: LoginCredentials): Promise<void> {
    await this.selectAdminMode();
    await this.fillAdminForm(credentials);
    await this.submitButton.click();
  }

  /**
   * Fill and submit the tenant-user form (UserApp or TenantAdmin). Flat object so
   * the step title masks `password`. Does not wait for the outcome: the caller
   * asserts it.
   */
  @step
  async signInAsTenantUser(credentials: LoginCredentials): Promise<void> {
    await this.selectTenantMode();
    await this.fillAdminForm(credentials);
    await this.submitButton.click();
  }

  /** Is the SPA session metadata present in sessionStorage? */
  private async hasUiSession(): Promise<boolean> {
    return this.page.evaluate(key => sessionStorage.getItem(key) !== null, config.auth.uiSessionKey);
  }

  // ============================================
  // ATCs - Complete Test Cases
  // ============================================

  /**
   * ATC AUT-001: the login screen offers the Admin / Tenant selector, and
   * choosing a mode shows its form.
   *
   * IMPORTANT: Call goto() before this ATC.
   */
  @atc('AUT-001')
  async showModeSelectorAndAdminForm(): Promise<void> {
    await expect(this.adminModeButton).toBeVisible();
    await expect(this.tenantModeButton).toBeVisible();
    // No form until a mode is chosen
    await expect(this.usernameInput).toHaveCount(0);

    await this.selectAdminMode();

    await expect(this.passwordInput).toBeVisible();
    await expect(this.submitButton).toBeEnabled();
  }

  /**
   * ATC AUT-002: administrator signs in with valid credentials and lands on
   * the dashboard with a live session.
   *
   * IMPORTANT: Call goto() before this ATC.
   * Success is the route AND the dashboard content AND the HttpOnly session
   * cookie: a redirect alone would also happen on a half-established session.
   *
   * @param credentials - Administrator user name and password
   */
  @atc('AUT-002')
  async loginAsAdminSuccessfully(credentials: LoginCredentials): Promise<void> {
    await this.selectAdminMode();
    await this.fillAdminForm(credentials);
    await this.submitButton.click();

    await expect(this.page).toHaveURL(/\/dashboard$/);
    await expect(this.dashboardHeading).toBeVisible();

    const cookies = await this.page.context().cookies();
    expect(cookies.find(c => c.name === 'access_token')?.httpOnly).toBe(true);
    expect(cookies.map(c => c.name)).toContain('csrf_token');
  }

  /**
   * ATC AUT-006: submitting the admin form with the user and password empty is
   * rejected on the client, per field, and nothing is sent.
   *
   * IMPORTANT: Call goto() before this ATC.
   */
  @atc('AUT-006')
  async submitEmptyAdminForm(): Promise<void> {
    await this.selectAdminMode();

    // Chrome may autofill; the case is about empty fields, so make them empty.
    await this.usernameInput.fill('');
    await this.passwordInput.fill('');
    await this.submitButton.click();

    await expect(this.page.getByText(/requerid[oa]/i)).toHaveCount(2);
    await expect(this.page).toHaveURL(/\/login$/);
  }

  /**
   * ATC AUT-007: wrong credentials show a generic message that does not say
   * which field failed, and no session is created.
   *
   * IMPORTANT: Call goto() before this ATC. The backend allows 4 failed
   * attempts per 30 s per address: do not loop this ATC.
   *
   * @param credentials - Credentials that must be rejected
   */
  @atc('AUT-007')
  async loginAsAdminWithInvalidCredentials(credentials: LoginCredentials): Promise<void> {
    await this.selectAdminMode();
    await this.fillAdminForm(credentials);
    await this.submitButton.click();

    await expect(this.wrongCredentialsMessage).toBeVisible();
    await expect(this.page).toHaveURL(/\/login$/);

    const cookies = await this.page.context().cookies();
    expect(cookies.map(c => c.name)).not.toContain('access_token');
  }

  /**
   * ATC AUT-010: repeated failed logins end in a 429 from the backend limiter,
   * and the SPA shows the waiting notice with a countdown and a disabled
   * "Espera Ns" button. The test then waits for the lock to be released so the
   * shared address is clean when it ends: the SPA notice gone and the button
   * enabled AND, if the backend answered a 429, at least ~31 s elapsed since the
   * first 429 seen (the SPA may not have shown the notice, so the UI alone does
   * not prove the backend lock is over). If the body fails, the release wait
   * still runs; if that wait fails too, the original error is the one reported
   * and a `release-failed` annotation warns that the address may stay locked.
   *
   * IMPORTANT: Call goto() before this ATC. The limiter is per remote address
   * (4 failures in 30 s block 30 s) and affects every client behind the proxy.
   * Credentials MUST be generated and non-existent; never the real account.
   * The backend sends no Retry-After header (HAL-10), so it is not asserted.
   *
   * @param credentials - Generated credentials that do not exist
   */
  @atc('AUT-010')
  async showRateLimitNoticeAfterFailedLogins(credentials: LoginCredentials): Promise<void> {
    const loginStatuses: number[] = [];
    const isLoginCall = (response: Response) =>
      response.request().method() === 'POST' && /\/api\/auth\/login\/admin/i.test(response.url());
    // Time of the FIRST 429 seen: the backend lock runs 30 s from there
    const rateLimit: { firstAt: number | undefined } = { firstAt: undefined };
    const onResponse = (response: Response) => {
      if (isLoginCall(response)) {
        loginStatuses.push(response.status());
        if (response.status() === 429) {
          rateLimit.firstAt ??= Date.now();
          const headers = Object.keys(response.headers()).filter(h => /retry|rate|limit/i.test(h));
          test.info().annotations.push({ type: 'login-429-headers', description: headers.join(',') || '(none)' });
        }
      }
    };
    this.page.on('response', onResponse);
    const startedAt = Date.now();
    let releaseError: unknown;
    let bodyPassed = false;

    try {
      await this.selectAdminMode();

      // Up to 5 attempts, stopping as soon as the notice appears
      for (let attempt = 1; attempt <= 5; attempt++) {
        if (await this.rateLimitNotice.isVisible()) {
          break;
        }
        await this.fillAdminForm(credentials);
        await Promise.all([
          this.page.waitForResponse(isLoginCall),
          this.submitButton.click(),
        ]);
        await expect(this.wrongCredentialsMessage.or(this.rateLimitNotice)).toBeVisible();
      }

      await expect(this.rateLimitNotice).toBeVisible();
      await expect(this.waitingButton).toBeDisabled();
      await expect(this.page).toHaveURL(/\/login$/);
      test.info().annotations.push({ type: 'login-statuses', description: loginStatuses.join(',') });
      expect(loginStatuses).toContain(429);

      const firstSeconds = await this.readNoticeSeconds();
      expect(firstSeconds).not.toBeNull();
      expect(firstSeconds).toBeGreaterThan(0);
      // 30 s default plus up to 1 s of lag: the SPA ticker refreshes "now" once per second
      expect(firstSeconds).toBeLessThanOrEqual(31);
      test.info().annotations.push({ type: 'notice-first-seconds', description: String(firstSeconds) });

      // The countdown moves: an absent notice never counts as "lower"
      await expect.poll(
        async () => (await this.readNoticeSeconds()) ?? Number.POSITIVE_INFINITY,
        { timeout: 10000 },
      ).toBeLessThan(firstSeconds as number);

      const cookies = await this.page.context().cookies();
      expect(cookies.map(c => c.name)).not.toContain('access_token');
      bodyPassed = true;
    }
    finally {
      this.page.off('response', onResponse);
      // Release: ALWAYS wait for the lock to go away so the shared address ends clean.
      // On a failing run its own errors must not mask the original failure.
      try {
        await expect(this.rateLimitNotice).toBeHidden({ timeout: 40000 });
        await expect(this.submitButton).toBeEnabled({ timeout: 40000 });
        // The UI can miss a 429 the backend did answer: also wait ~31 s from the first one (web-first poll on elapsed time)
        if (rateLimit.firstAt !== undefined) {
          const firstAt = rateLimit.firstAt;
          await expect.poll(() => Date.now() - firstAt, { timeout: 35000, intervals: [500] }).toBeGreaterThanOrEqual(31000);
        }
        test.info().annotations.push({ type: 'total-seconds', description: String(Math.round((Date.now() - startedAt) / 1000)) });
      }
      catch (error) {
        // Kept, not thrown here: throwing inside `finally` would mask the original failure
        releaseError = error;
        if (!bodyPassed) {
          // The body already failed, so this error is not thrown: leave a trace that the address may stay locked
          const firstLine = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0].slice(0, 200);
          test.info().annotations.push({ type: 'release-failed', description: firstLine });
        }
      }
    }
    // Reached only when the body passed: then a release failure is the failure
    if (releaseError !== undefined) {
      throw releaseError;
    }
  }

  /**
   * ATC AUT-009: a platform Admin that reaches the global failed-login
   * threshold is locked: the SPA shows the lock message, and even the CORRECT
   * password is then rejected with the same message.
   *
   * IMPORTANT: Call goto() before this ATC. The account MUST be a generated,
   * NON-root Admin; the real account is never sent a wrong password. The
   * threshold (`maxAttempts`, read by the spec from the security config API)
   * must be at most 3: the address limiter (4 failures in 30 s) would trip
   * first otherwise, so a higher value is a failure of the precondition, not
   * of the product. Failures sent: `maxAttempts` wrong + 1 correct-but-locked.
   * The "10 minutes" of the case only applies to the ROOT account (timed
   * lockout); any other Admin is locked until an administrator unlocks it, even
   * though the SPA text says "Espera 10 minutos" (automation plan, Contradiction #1).
   * A first sign-in with the correct password (positive control) proves the
   * account works before it is locked. The limiter window is waited out in
   * `finally`, measured from the LAST rejected login (429 included).
   *
   * @param credentials - Generated Admin user name and its CORRECT password
   * @param maxAttempts - Global Admin threshold of failed logins (1 to 3)
   */
  @atc('AUT-009')
  async lockGeneratedAdminAfterFailedLogins(credentials: LoginCredentials, maxAttempts: number): Promise<void> {
    expect(maxAttempts, 'the global Admin threshold must be at least 1').toBeGreaterThanOrEqual(1);
    expect(maxAttempts, 'the global Admin threshold must be <= 3 or the address limiter trips first').toBeLessThanOrEqual(3);

    const isLoginCall = (response: Response) =>
      response.request().method() === 'POST' && /\/api\/auth\/login\/admin/i.test(response.url());
    const limiter = this.watchRejectedLogins();
    const submitAndWait = async (password: string) => {
      await this.fillSecret(this.passwordInput, password);
      const [response] = await Promise.all([this.page.waitForResponse(isLoginCall), this.submitButton.click()]);
      return response;
    };
    let bodyPassed = false;

    try {
      await this.selectAdminMode();
      await this.usernameInput.fill(credentials.username);

      // Positive control: the account works before it is locked
      await submitAndWait(credentials.password);
      await expect(this.page).toHaveURL(/\/dashboard$/);
      await this.page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(this.adminModeButton).toBeVisible();
      await this.selectAdminMode();
      await this.usernameInput.fill(credentials.username);

      // Wrong passwords up to the threshold: the last one locks the account
      const wrongPassword = this.data.createWrongPassword();
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await submitAndWait(wrongPassword);
        expect(response.status(), `wrong password, attempt ${attempt}`).toBe(401);
        const bodyText = await response.text();
        let bodyKeys = 'n/a';
        try {
          bodyKeys = Object.keys(JSON.parse(bodyText) as object).join(',');
        }
        catch {
          // Diagnostic only: a non-JSON body must not hide the status assertion above
        }
        test.info().annotations.push({
          type: `wrong-attempt-${attempt}`,
          description: `max=${maxAttempts} status=${response.status()} backendLocked=${bodyText.includes('ACCOUNT_LOCKED')} keys=${bodyKeys}`,
        });
        if (attempt < maxAttempts) {
          await expect(this.wrongCredentialsMessage).toBeVisible();
        }
      }
      await expect(this.accountLockedMessage).toBeVisible();
      await expect(this.page).toHaveURL(/\/login$/);

      // The CORRECT password is rejected with the same lock message
      const lockedResponse = await submitAndWait(credentials.password);
      expect(lockedResponse.status(), 'correct password on a locked account').toBe(401);
      expect(await lockedResponse.text()).toContain('ACCOUNT_LOCKED');
      await expect(this.accountLockedMessage).toBeVisible();
      await expect(this.page).toHaveURL(/\/login$/);

      const cookies = await this.page.context().cookies();
      expect(cookies.map(c => c.name)).not.toContain('access_token');
      bodyPassed = true;
    }
    finally {
      limiter.stop();
      await this.releaseLimiterAfterBody(limiter.lastAt, bodyPassed);
    }
  }

  /**
   * ATC AUT-038: when the login call is answered with `CRYPTO_SESSION_EXPIRED`,
   * the SPA must ask the user to repeat the action, not claim the credentials
   * are wrong, and must open a fresh crypto session (new handshake).
   *
   * IMPORTANT: Call goto() before this ATC. Credentials MUST be generated and
   * non-existent; never the real account. The expired session is simulated by
   * rewriting `X-Session-Id` of the FIRST login call to an unknown id (the real
   * 30-minute expiry is not reproduced). One rejected login: the limiter window
   * is waited out in `finally`. HAL-51: today the SPA shows "Credenciales
   * incorrectas", so this ATC is expected to fail until that is fixed.
   *
   * @param credentials - Generated credentials that do not exist
   */
  @atc('AUT-038')
  async retryAfterCryptoSessionExpired(credentials: LoginCredentials): Promise<void> {
    const isLoginCall = (response: Response) =>
      response.request().method() === 'POST' && /\/api\/auth\/login\//i.test(response.url());
    const handshakes: string[] = [];
    const onRequest = (request: Request) => {
      if (request.method() === 'POST' && /\/api\/handshake/i.test(request.url())) {
        handshakes.push(request.url());
      }
    };
    let rewritten = false;
    // Handshakes seen up to the moment the expired-session answer arrived: only a later one proves the SPA recovered
    let handshakesAtExpiry: number | undefined;
    let bodyPassed = false;
    const limiter = this.watchRejectedLogins();
    const onExpiredAnswer = (response: Response) => {
      if (isLoginCall(response) && response.status() === 401) {
        handshakesAtExpiry ??= handshakes.length;
      }
    };
    this.page.on('response', onExpiredAnswer);

    await this.page.route('**/api/auth/login/**', async (route) => {
      if (rewritten) {
        await route.continue();
        return;
      }
      rewritten = true;
      await route.continue({ headers: { ...route.request().headers(), 'x-session-id': randomUUID() } });
    });
    this.page.on('request', onRequest);

    try {
      await this.selectAdminMode();
      await this.fillAdminForm(credentials);
      const [response] = await Promise.all([this.page.waitForResponse(isLoginCall), this.submitButton.click()]);
      test.info().annotations.push({ type: 'login-status', description: String(response.status()) });
      expect(response.status()).toBe(401);
      expect(await response.text()).toContain('CRYPTO_SESSION_EXPIRED');

      // Correct behaviour: ask to repeat, never "wrong credentials"
      await expect(this.formErrorMessage).toHaveText('La sesión de cifrado expiró. Por favor, repite la acción.');
      await expect(this.repeatActionMessage).toBeVisible();
      await expect(this.wrongCredentialsMessage).toHaveCount(0);
      await expect(this.page).toHaveURL(/\/login$/);

      // A fresh crypto session was opened AFTER the expiry answer (a lazy handshake before the submit does not count)
      expect(handshakesAtExpiry, 'the expired-session answer was observed').toBeDefined();
      await expect.poll(() => handshakes.length - (handshakesAtExpiry as number), { timeout: 5000 })
        .toBeGreaterThan(0);
      bodyPassed = true;
    }
    finally {
      this.page.off('request', onRequest);
      this.page.off('response', onExpiredAnswer);
      limiter.stop();
      await this.page.unroute('**/api/auth/login/**');
      await this.releaseLimiterAfterBody(limiter.lastAt, bodyPassed);
    }
  }

  /**
   * ATC AUT-034: after 15 minutes without activity the SPA signs the user out
   * on its own and leaves them on the login screen.
   *
   * Scope: the CLIENT inactivity timer (a 15 min setTimeout in the SPA) under
   * Playwright's clock control. It does NOT wait 15 real minutes and does NOT
   * prove server-side token revocation. Under the fast-forwarded clock the
   * X-Timestamp of the logout call is far ahead of the server's, so the server
   * rejects that logout: each run leaves one admin server session alive (a 7-day
   * refresh token) and server-side revocation is NOT exercised by this case.
   *
   * Do NOT call goto() before this ATC: the clock must be installed before the
   * SPA boots, so the ATC navigates by itself. Needs a signed-out context
   * (own login, never the shared saved session).
   *
   * @param credentials - Administrator user name and password
   */
  @atc('AUT-034')
  async logoutAfterInactivity(credentials: LoginCredentials): Promise<void> {
    const logoutRequests: string[] = [];
    const isLogoutRequest = (request: Request) =>
      request.method() === 'POST' && /\/api\/auth\/logout/i.test(request.url());
    const onRequest = (request: Request) => {
      if (isLogoutRequest(request)) {
        logoutRequests.push(request.url());
      }
    };
    this.page.on('request', onRequest);

    try {
      await this.page.clock.install();
      await this.goto();
      await this.selectAdminMode();
      await this.fillAdminForm(credentials);
      await this.submitButton.click();
      await expect(this.page).toHaveURL(/\/dashboard$/);
      await expect(this.dashboardHeading).toBeVisible();

      // Just before the limit (real time keeps flowing, hence the margin): still signed in
      await this.page.clock.fastForward('14:00');
      await expect(this.page).toHaveURL(/\/dashboard$/);
      expect(logoutRequests).toHaveLength(0);
      expect(await this.hasUiSession()).toBe(true);

      // Past the limit: the timer fires and the SPA signs out
      const [response] = await Promise.all([
        this.page.waitForResponse(
          response => response.request().method() === 'POST' && /\/api\/auth\/logout/i.test(response.url()),
        ),
        this.page.clock.fastForward('01:30'),
      ]);
      test.info().annotations.push({ type: 'logout-response-status', description: String(response.status()) });

      await expect(this.page).toHaveURL(/\/login$/);
      await expect(this.adminModeButton).toBeVisible();
      await expect.poll(async () => this.hasUiSession()).toBe(false);

      // A protected route no longer opens
      await this.page.goto(this.buildUrl('/dashboard'));
      await expect(this.page).toHaveURL(/\/login$/);
    }
    finally {
      this.page.off('request', onRequest);
    }
  }

  /**
   * ATC AUT-004: a valid UserApp signs in through the tenant form and lands on
   * its log screen with a live session.
   *
   * IMPORTANT: Call goto() before this ATC. Needs a signed-out context and a
   * generated UserApp (never the real account). The tenant form has the same
   * two fields as the admin one, so the admin fill helper is reused.
   *
   * @param credentials - Generated UserApp user name and password
   */
  @atc('AUT-004')
  async loginAsUserAppSuccessfully(credentials: LoginCredentials): Promise<void> {
    await this.selectTenantMode();
    await this.fillAdminForm(credentials);
    await this.submitButton.click();

    await expect(this.page).toHaveURL(/\/logs\/consultas-nr$/);
    // The UserApp menu shows the log entries
    await expect(this.page.getByRole('link', { name: 'Log Consultas' })).toBeVisible();

    const cookies = await this.page.context().cookies();
    expect(cookies.find(c => c.name === 'access_token')?.httpOnly).toBe(true);
  }

  /**
   * ATC AUT-008: a deactivated and a deleted UserApp are both denied access
   * with a visible message, and no session is created. Two data rows of the
   * same case, in one flow.
   *
   * IMPORTANT: Call goto() before this ATC. The accounts must already be
   * deactivated / deleted (done by the spec through the data helper). Each row
   * is one failed login, so the shared address limiter (4 failures in 30 s)
   * stays below its threshold; the ATC waits out the window in `finally`.
   * The positive control (an active UserApp of the same tenant signs in with
   * this form) is AUT-004.
   *
   * @param accounts - The two rows of the case
   * @param accounts.inactive - Generated UserApp credentials, already deactivated
   * @param accounts.deleted - Generated UserApp credentials, already deleted
   */
  @atc('AUT-008')
  async loginWithInactiveOrDeletedUser(
    accounts: { inactive: LoginCredentials, deleted: LoginCredentials },
  ): Promise<void> {
    const limiter = this.watchRejectedLogins();
    let bodyPassed = false;
    try {
      await this.selectTenantMode();
      await this.submitRejectedLogin(accounts.inactive);

      // Clean login screen for the second row
      await this.goto();
      await this.selectTenantMode();
      await this.submitRejectedLogin(accounts.deleted);
      bodyPassed = true;
    }
    finally {
      limiter.stop();
      await this.releaseLimiterAfterBody(limiter.lastAt, bodyPassed);
    }
  }

  /**
   * ATC AUT-012: each form accepts only its own kind of principal. A UserApp in
   * the administrator form and a platform Admin in the tenant form are both
   * rejected, and no session is created.
   *
   * IMPORTANT: Call goto() before this ATC. Credentials MUST be generated; the
   * real account is never sent. Two failed logins in total, below the limiter
   * threshold; the ATC waits out the window in `finally`.
   *
   * @param principals - The two principals of the case
   * @param principals.userApp - Generated UserApp credentials (sent to the admin form)
   * @param principals.admin - Generated platform Admin credentials (sent to the tenant form)
   */
  @atc('AUT-012')
  async loginInTheWrongMode(
    principals: { userApp: LoginCredentials, admin: LoginCredentials },
  ): Promise<void> {
    const limiter = this.watchRejectedLogins();
    let bodyPassed = false;
    try {
      await this.selectAdminMode();
      await this.submitRejectedLogin(principals.userApp);

      await this.goto();
      await this.selectTenantMode();
      await this.submitRejectedLogin(principals.admin);
      bodyPassed = true;
    }
    finally {
      limiter.stop();
      await this.releaseLimiterAfterBody(limiter.lastAt, bodyPassed);
    }
  }

  /**
   * ATC AUT-013: a signed-in user who opens /login is sent to the dashboard
   * (loginRedirectGuard) instead of seeing the login form. Read-only.
   *
   * IMPORTANT: Do NOT call goto() (it expects the login form). Needs the saved
   * Administrator session (the e2e default); nothing is changed on it.
   */
  @atc('AUT-013')
  async openLoginWhileSignedIn(): Promise<void> {
    await this.page.goto(this.buildUrl('/login'));

    await expect(this.page).toHaveURL(/\/dashboard$/);
    await expect(this.dashboardHeading).toBeVisible();
    await expect(this.adminModeButton).toHaveCount(0);
  }

  /**
   * ATC AUT-003: a valid TenantAdmin signs in through the tenant form and lands
   * on its panel (/admin-panel) with a live session.
   *
   * IMPORTANT: Call goto() before this ATC. Needs a signed-out context. This is
   * the REAL TenantAdmin account (`config.tenantAdminUser`): only positive logins
   * are ever sent to it, because a failed attempt counts toward its lockout.
   *
   * @param credentials - TenantAdmin user name (the email) and password
   */
  @atc('AUT-003')
  async loginAsTenantAdminSuccessfully(credentials: LoginCredentials): Promise<void> {
    await this.selectTenantMode();
    await this.fillAdminForm(credentials);
    await this.submitButton.click();

    await expect(this.page).toHaveURL(/\/admin-panel$/);
    // The TenantAdmin menu starts with its own panel entry
    await expect(this.page.getByRole('link', { name: 'Mi Panel' })).toBeVisible();

    const cookies = await this.page.context().cookies();
    expect(cookies.find(c => c.name === 'access_token')?.httpOnly).toBe(true);
    expect(cookies.map(c => c.name)).toEqual(expect.arrayContaining(['refresh_token', 'csrf_token']));
  }

  /**
   * ATC AUT-005: a TenantAdmin whose account still has `mustChangePassword = true`
   * (a pending account signing in with the temporary password from the welcome
   * mail) is sent to /change-password, shown the
   * token field, and NOT to its panel.
   *
   * IMPORTANT: Call goto() before this ATC. Needs a signed-out context. The
   * account is a GENERATED pending TenantAdmin: positive login only. The
   * temporary password reaches this method only as the flat `password` field
   * (masked in the step title); the caller resolves it just before the call.
   *
   * @param credentials - Generated recipient (the user name) and its temporary password
   */
  @atc('AUT-005')
  async redirectMustChangePasswordTenantAdmin(credentials: LoginCredentials): Promise<void> {
    await this.selectTenantMode();
    await this.fillAdminForm(credentials);
    await this.submitButton.click();

    await expect(this.page).toHaveURL(/\/change-password$/);
    await expect(this.page.locator('input[formcontrolname="token"]')).toBeVisible();
  }
}
