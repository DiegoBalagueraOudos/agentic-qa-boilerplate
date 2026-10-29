/**
 * KATA Architecture - Layer 3: Activation Page Component
 *
 * UI component for the account activation screen of the Validate SPA:
 * `/activate?token=<activation token>`. The person sets a definitive password;
 * an expired link leads to a sub-form that asks for a new link by email.
 *
 * ATC ids are the local case ids under .context/QA/cases/ (no TMS in this project).
 *
 * Page: /activate (the same component also serves /change-password: a session
 * whose account still has `mustChangePassword = true` lands there)
 * The SPA exposes no data-testid, and the field labels are not associated with
 * their inputs (`getByLabel` does not work). Locators use roles, visible text and
 * the Angular `formcontrolname` attribute.
 */

import type { Request, Response } from '@playwright/test';
import type { TestContextOptions } from '@TestContext';

import { expect, test } from '@playwright/test';
import { UiBase } from '@ui/UiBase';
import { atc } from '@utils/decorators';

// ============================================
// Types - Activation data structures
// ============================================

/**
 * Data of one activation attempt. The token is a generated fake: it never
 * belongs to a real account. The keys are `token` and `password` on purpose: the
 * ATC decorator masks those exact names in the title.
 */
export interface ActivationAttempt {
  token: string
  password: string
}

/**
 * Activation of a REAL pending account (AUT-020). The token only travels as a thunk
 * (prints as `[Function]` in the step title); `password` is masked by key.
 */
export interface MailedActivation {
  readToken: () => Promise<string>
  password: string
  /** Positive login with the new password, run by the caller (a component does not call another). */
  signInAfter: () => Promise<void>
}

/** Resend flow of a REAL pending account (AUT-025). Secrets only as thunks; `password` masked by key. */
export interface MailedResend {
  username: string
  password: string
  readOldToken: () => Promise<string>
  readNewToken: () => Promise<string>
  waitForResentMail: () => Promise<void>
  /** Wait until the mail sandbox accepts another message (it drops mails sent too close together). */
  waitForMailSlot: () => Promise<void>
}

/**
 * One weak-password row: what is typed and the message the screen must show.
 */
interface WeakPasswordRow {
  typed: string
  message: string
}

/** One route a pending account must NOT be able to reach (AUT-027). */
interface ForcedNavigationRow {
  route: string
  label: string
}

// ============================================
// Activation Page Component
// ============================================

export class ActivationPage extends UiBase {
  constructor(options: TestContextOptions) {
    super(options);
  }

  // ============================================
  // Locators (reused across ATCs)
  // ============================================

  private get newPasswordInput() {
    return this.page.locator('input[formcontrolname="newPassword"]');
  }

  private get confirmPasswordInput() {
    return this.page.locator('input[formcontrolname="confirmPassword"]');
  }

  private get activateButton() {
    return this.page.getByRole('button', { name: 'Activar cuenta' });
  }

  private get validLinkBanner() {
    return this.page.getByText('Enlace válido. Establece tu nueva contraseña.');
  }

  private get resendLinkButton() {
    return this.page.getByRole('button', { name: '¿El enlace expiró? Reenviar nuevo enlace' });
  }

  private get minLengthMessage() {
    return this.page.getByText('Mínimo 8 caracteres');
  }

  private get complexityMessage() {
    return this.page.getByText('Debe tener mayúscula, minúscula y número');
  }

  /**
   * Any error state after a rejected activation: the "Enlace no válido" /
   * "Enlace expirado" panels or the inline "Error inesperado" text.
   */
  private get rejectionState() {
    return this.page.getByText(/Enlace no válido|Enlace expirado|Error inesperado|inválido|expirado/i).first();
  }

  private get activatedHeading() {
    return this.page.getByRole('heading', { name: '¡Cuenta activada!' });
  }

  // ============================================
  // Helpers (Private)
  // ============================================

  private async openWithToken(activationToken: string): Promise<void> {
    await this.page.goto(this.buildUrl(`/activate?token=${encodeURIComponent(activationToken)}`));
    await expect(this.validLinkBanner).toBeVisible();
  }

  /**
   * Open the activation link of a real account. The token comes from a thunk and the
   * navigation is done inside the page (`location.assign`) so the tokenised URL never
   * becomes a step title (`page.goto(url)` would print it into the report).
   */
  private async openWithMailedToken(readToken: () => Promise<string>, expectBanner = true): Promise<void> {
    await this.page.goto(this.buildUrl('/login'));
    const target = this.buildUrl(`/activate?token=${encodeURIComponent(await readToken())}`);
    await this.page.evaluate((url) => {
      location.assign(url);
    }, target);
    if (expectBanner) {
      await expect(this.validLinkBanner).toBeVisible();
    }
    else {
      // A replaced token still shows the banner (HAL-06): the form being usable is what the caller needs
      await expect(this.newPasswordInput).toBeVisible();
    }
  }

  private isLimitedCall(response: Response): boolean {
    return response.request().method() === 'POST'
      && /\/api\/auth\/tenant-admin\/(?:activate|resend-activation)/i.test(response.url());
  }

  /**
   * Record the time of the LAST call counted by the `rl-auth` limiter (activate and
   * resend, any status, 429 included) from a listener that exists before the clicks.
   */
  private watchLimitedCalls(): { readonly lastAt: number | undefined, stop: () => void } {
    const state: { lastAt: number | undefined } = { lastAt: undefined };
    const onResponse = (response: Response) => {
      if (this.isLimitedCall(response)) {
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
   * Wait until the `rl-auth` window (4 per 30 s) is over, measured from the last
   * limited call, so the next spec starts clean. Elapsed-time poll, never a fixed
   * sleep. A body that passed turns a release failure into the failure; a body that
   * already failed keeps its own error and leaves a `release-failed` note.
   */
  private async releaseLimiterWindow(lastAt: number | undefined, bodyPassed: boolean): Promise<void> {
    if (lastAt === undefined) {
      return;
    }
    try {
      await expect.poll(() => Date.now() - lastAt, { timeout: 35000, intervals: [500] })
        .toBeGreaterThanOrEqual(31000);
    }
    catch (error) {
      if (bodyPassed) {
        throw error;
      }
      const firstLine = (error instanceof Error ? error.message : String(error)).split(/\r?\n/)[0].slice(0, 200);
      test.info().annotations.push({ type: 'release-failed', description: firstLine });
    }
  }

  private async resendFromForm(username: string): Promise<void> {
    await this.resendLinkButton.click();
    await this.page.getByPlaceholder('correo@empresa.com').fill(username);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        r => r.request().method() === 'POST' && /\/api\/auth\/tenant-admin\/resend-activation/i.test(r.url()),
      ),
      this.page.getByRole('button', { name: 'Reenviar enlace' }).click(),
    ]);
    // The on-screen confirmation is not asserted (AUT-026-BUG-1): the request and the mail are the proof
    expect(response.status(), 'the resend request is accepted').toBe(200);
  }

  private async resendAndRejectOldTokenBody(flow: MailedResend): Promise<void> {
    await this.openWithMailedToken(flow.readOldToken);
    await flow.waitForMailSlot();
    await this.resendFromForm(flow.username);
    await flow.waitForResentMail();

    // The previous link no longer resolves: refused and the account is not activated
    await this.openWithMailedToken(flow.readOldToken, false);
    await this.fillPasswords(flow.password, flow.password);
    expect(await this.submitActivation(), 'the replaced token is refused').toBe(400);
    await expect(this.activatedHeading).toHaveCount(0);

    // Positive control: the new link activates the same account
    await this.openWithMailedToken(flow.readNewToken);
    await this.fillPasswords(flow.password, flow.password);
    expect(await this.submitActivation(), 'the new token activates the account').toBe(200);
    await expect(this.activatedHeading).toBeVisible();
  }

  private async fillPasswords(newPassword: string, confirmation: string): Promise<void> {
    await this.fillSecret(this.newPasswordInput, newPassword);
    await this.fillSecret(this.confirmPasswordInput, confirmation);
  }

  /**
   * Submit the form and wait for the activation call to answer. Returns the
   * HTTP status so the ATC can tell that the backend was reached.
   */
  private async submitActivation(): Promise<number> {
    const isActivationCall = (response: Response) =>
      response.request().method() === 'POST' && /\/api\/auth\/tenant-admin\/activate/i.test(response.url());
    const [response] = await Promise.all([
      this.page.waitForResponse(isActivationCall),
      this.activateButton.click(),
    ]);
    return response.status();
  }

  // ============================================
  // ATCs - Complete Test Cases
  // ============================================

  /**
   * ATC AUT-020: a real pending account (token from the welcome mail) activates
   * with a valid password: the activation call answers 200, "¡Cuenta activada!" is
   * shown, the button "Ir al inicio de sesión" leads to /login (the SPA has no
   * automatic redirect; owner Q1) and a positive login with the new password works.
   * Spends 1 `rl-auth` permit.
   *
   * IMPORTANT: Needs a signed-out context.
   *
   * @param flow - Token thunk, generated valid password and the caller's login
   */
  @atc('AUT-020')
  async activateWithMailedToken(flow: MailedActivation): Promise<void> {
    const limiter = this.watchLimitedCalls();
    let bodyPassed = false;
    try {
      await this.activateWithMailedTokenBody(flow);
      bodyPassed = true;
    }
    finally {
      limiter.stop();
      await this.releaseLimiterWindow(limiter.lastAt, bodyPassed);
    }
  }

  private async activateWithMailedTokenBody(flow: MailedActivation): Promise<void> {
    await this.openWithMailedToken(flow.readToken);
    await this.fillPasswords(flow.password, flow.password);
    expect(await this.submitActivation(), 'the activation call succeeds').toBe(200);
    await expect(this.activatedHeading).toBeVisible();

    await this.page.getByRole('button', { name: 'Ir al inicio de sesión' }).click();
    // Pathname only: while the URL may still carry the real token, a failing toHaveURL would print it
    await expect.poll(() => new URL(this.page.url()).pathname, { message: 'the button leads to /login' }).toBe('/login');

    await flow.signInAfter();
  }

  /**
   * ATC AUT-025: resending the activation (from the SPA form) sends a NEW mail
   * with a different token; the previous token is refused (400) and the new one
   * activates the account. The on-screen confirmation of the resend is not asserted
   * (AUT-026-BUG-1). Spends 3 `rl-auth` permits (resend, refused activate, good
   * activate) and then waits out the 30 s window so neighbouring specs are not limited.
   *
   * IMPORTANT: Needs a signed-out context and a pending account that has had its
   * first mail read and deleted.
   *
   * @param flow - Account e-mail, generated valid password and token thunks
   */
  @atc('AUT-025')
  async resendActivationAndRejectOldToken(flow: MailedResend): Promise<void> {
    const limiter = this.watchLimitedCalls();
    let bodyPassed = false;
    try {
      await this.resendAndRejectOldTokenBody(flow);
      bodyPassed = true;
    }
    finally {
      limiter.stop();
      await this.releaseLimiterWindow(limiter.lastAt, bodyPassed);
    }
  }

  /**
   * ATC AUT-021: the token arrives through `?token=` in the URL. The screen
   * confirms a valid link and does NOT ask for the token (the value is kept in
   * the form, not in a visible field); submitting calls the activation endpoint,
   * which answers a client error (4xx, not 5xx) for the generated fake token, so
   * an error is shown. The request body is encrypted, so that the URL token is
   * the value sent is NOT compared here (it would mean reading the token).
   * Live, the screen shows the inline "Error inesperado" text, not the
   * "Enlace no válido" panel (HAL-06).
   *
   * IMPORTANT: Needs a signed-out context. Do NOT call another ATC before this.
   *
   * @param attempt - Generated fake token and a password that passes the rules
   */
  @atc('AUT-021')
  async openActivationLinkWithToken(attempt: ActivationAttempt): Promise<void> {
    await this.openWithToken(attempt.token);

    // Only the two password fields are rendered: no field for the token
    await expect(this.newPasswordInput).toBeVisible();
    await expect(this.confirmPasswordInput).toBeVisible();
    await expect(this.page.locator('input[formcontrolname="token"]')).toHaveCount(0);
    await expect(this.page.getByText(/^Token$/i)).toHaveCount(0);

    await this.fillPasswords(attempt.password, attempt.password);
    const status = await this.submitActivation();

    // The activation call went out after the submit and was refused as a client error, not a server failure
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    await expect(this.rejectionState).toBeVisible();
    await expect(this.activatedHeading).toHaveCount(0);
  }

  /**
   * ATC AUT-022 (invalid-token variant): a fake token with a valid password is
   * rejected, an error state is shown and the account is not activated.
   * Expired and reused tokens need a real token delivered by email and are not
   * exercised here.
   *
   * IMPORTANT: Needs a signed-out context.
   *
   * @param attempt - Generated fake token and a password that passes the rules
   */
  @atc('AUT-022')
  async activateWithInvalidToken(attempt: ActivationAttempt): Promise<void> {
    await this.openWithToken(attempt.token);
    await this.fillPasswords(attempt.password, attempt.password);
    const status = await this.submitActivation();

    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    // An error state is on screen, whatever its wording
    await expect(this.rejectionState).toBeVisible();
    await expect(this.activatedHeading).toHaveCount(0);
    await expect(this.page).not.toHaveURL(/\/dashboard/);
  }

  /**
   * ATC AUT-023: passwords that break the rules show their message on the
   * client and nothing is sent. Messages verified on the live screen: a
   * password under 8 characters shows only "Mínimo 8 caracteres"; a long one
   * missing upper case, lower case or a digit shows "Debe tener mayúscula,
   * minúscula y número"; a compliant one shows no error.
   *
   * IMPORTANT: Needs a signed-out context.
   *
   * Each weak password is also submitted ("Activar cuenta", confirmation equal
   * to the password): the button may be disabled or the form may refuse, and in
   * both cases no activation request may leave the browser.
   *
   * The fake token is generated inside, so no secret-shaped value is an argument.
   */
  @atc('AUT-023')
  async rejectWeakPasswords(): Promise<void> {
    const sent: string[] = [];
    const onRequest = (request: Request) => {
      if (request.method() === 'POST' && /\/api\/auth\/tenant-admin\/activate/i.test(request.url())) {
        sent.push(request.url());
      }
    };
    this.page.on('request', onRequest);
    try {
      await this.rejectWeakPasswordsBody();
    }
    finally {
      this.page.off('request', onRequest);
    }
    expect(sent, 'no activation request for a weak password').toHaveLength(0);
  }

  private async rejectWeakPasswordsBody(): Promise<void> {
    await this.openWithToken(this.data.createFakeActivationToken());

    const weakRows: WeakPasswordRow[] = [
      { typed: 'abc', message: 'Mínimo 8 caracteres' },
      { typed: 'abcdefgh', message: 'Debe tener mayúscula, minúscula y número' },
      { typed: 'ABCDEFGH', message: 'Debe tener mayúscula, minúscula y número' },
      { typed: 'abcdEFGH', message: 'Debe tener mayúscula, minúscula y número' },
    ];

    for (const row of weakRows) {
      await this.fillSecret(this.newPasswordInput, row.typed);
      await expect(this.page.getByText(row.message)).toBeVisible();
      // The other message must not be shown for the same row
      const other = row.message === 'Mínimo 8 caracteres' ? this.complexityMessage : this.minLengthMessage;
      await expect(other).toHaveCount(0);

      // Try to submit it: a disabled button ignores the forced click, an enabled one must not send
      await this.fillSecret(this.confirmPasswordInput, row.typed);
      await this.activateButton.click({ force: true });
      await this.page.waitForLoadState('networkidle');
    }

    // A compliant password clears both messages
    await this.fillSecret(this.newPasswordInput, 'Abcdef12');
    await expect(this.minLengthMessage).toHaveCount(0);
    await expect(this.complexityMessage).toHaveCount(0);
  }

  /**
   * ATC AUT-024: a confirmation that differs from the new password shows the
   * mismatch error; typing the same value shows that they match. Client-side only.
   *
   * IMPORTANT: Needs a signed-out context.
   *
   * @param attempt - Generated fake token and a password that passes the rules
   */
  @atc('AUT-024')
  async rejectMismatchedConfirmation(attempt: ActivationAttempt): Promise<void> {
    await this.openWithToken(attempt.token);

    await this.fillPasswords(attempt.password, `${attempt.password}x`);
    await expect(this.page.getByText('Las contraseñas no coinciden')).toBeVisible();
    await expect(this.page.getByText('Las contraseñas coinciden')).toHaveCount(0);

    await this.fillSecret(this.confirmPasswordInput, attempt.password);
    await expect(this.page.getByText('Las contraseñas coinciden')).toBeVisible();
    await expect(this.page.getByText('Las contraseñas no coinciden')).toHaveCount(0);
  }

  /**
   * ATC AUT-026: asking for a new link for an email that does not exist gets
   * the same generic answer as for a real one, so existence is not revealed.
   * Response timing (HAL-11) is not asserted.
   *
   * IMPORTANT: Needs a signed-out context. The email MUST be generated and
   * non-existent: no mail is sent.
   *
   * The fake token and the email are generated inside, so no secret-shaped value
   * is an argument.
   */
  @atc('AUT-026')
  async resendActivationForUnknownUser(): Promise<void> {
    const unknownEmail = this.data.createUnknownEmail();
    await this.openWithToken(this.data.createFakeActivationToken());
    await this.resendLinkButton.click();

    const emailInput = this.page.getByPlaceholder('correo@empresa.com');
    await emailInput.fill(unknownEmail);
    const isResendCall = (response: Response) =>
      response.request().method() === 'POST' && /\/api\/auth\/tenant-admin\/resend-activation/i.test(response.url());
    const [response] = await Promise.all([
      this.page.waitForResponse(isResendCall),
      this.page.getByRole('button', { name: 'Reenviar enlace' }).click(),
    ]);
    expect(response.status()).toBe(200);

    const generic = this.page.getByText('Si el correo está registrado y la cuenta está pendiente, recibirás un nuevo enlace en breve.');
    await expect(generic).toBeVisible();
    // No wording that says the account exists or not
    await expect(this.page.getByText(/no existe|no encontrado|no está registrado|not found/i)).toHaveCount(0);
  }

  /**
   * ATC AUT-027: with `mustChangePassword = true` the forced password change
   * cannot be skipped: navigating to another route of the app leaves the user on
   * /change-password. Each route is tried by direct URL; every row that ends
   * elsewhere is collected and ONE error lists them all (HAL-09 predicts the
   * rows fail today: the app loads the panel).
   *
   * IMPORTANT: Needs a session already signed in as a pending account that was
   * sent to /change-password (the caller does the sign-in; a component does not
   * call another). The UI is what is asserted; server-side refusal is not.
   */
  @atc('AUT-027')
  async keepForcedChangePasswordOnNavigation(): Promise<void> {
    const rows: ForcedNavigationRow[] = [
      { route: '/admin-panel', label: 'admin panel' },
      { route: '/dashboard', label: 'dashboard' },
    ];
    const misses: string[] = [];

    for (const row of rows) {
      await this.page.goto(this.buildUrl(row.route));
      try {
        // Condition-based: the SPA may redirect after boot; a short budget keeps a miss quick.
        // Pathname only; the notice wording is not part of this case (a text change is not HAL-09)
        await expect.poll(() => new URL(this.page.url()).pathname, { timeout: 5000 }).toBe('/change-password');
      }
      catch (error) {
        // Only an assertion miss counts as "skipped" (goto sits outside this try and rethrows on its
        // own); anything else, a closed page included, is a different failure
        if (this.page.isClosed() || !(error instanceof Error) || /Target (?:page|closed)|has been closed/i.test(error.message)) {
          throw error;
        }
        misses.push(`${row.label} (${row.route}): ended on ${new URL(this.page.url()).pathname}`);
        // Evidence taken at the moment of the miss: the failure screenshot comes after the
        // `finally` sign-out and would only show /login
        await test.info().attach(`forced-change-miss-${row.label.replace(/\s+/g, '-')}`, {
          body: await this.page.screenshot(),
          contentType: 'image/png',
        });
      }
    }

    if (misses.length > 0) {
      throw new Error(`forced password change was skipped, expected to stay on /change-password: ${misses.join('; ')}`);
    }
  }
}
