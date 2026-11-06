# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\auth\login-crypto-session.test.ts >> Login with an expired crypto session >> AUT-038: should ask to repeat the action instead of showing wrong credentials
- Location: tests\e2e\auth\login-crypto-session.test.ts (L20)

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('form p.text-center.text-red-600')
Expected: "La sesión de cifrado expiró. Por favor, repite la acción."
Received: "Credenciales incorrectas. Verifica tu usuario y contraseña."
Timeout:  10000ms

Call log:
  - Expect "toHaveText" with timeout 10000ms
  - waiting for locator('form p.text-center.text-red-600')
    23 × locator resolved to <p class="text-center text-xs text-red-600">Credenciales incorrectas. Verifica tu usuario y c…</p>
       - unexpected value "Credenciales incorrectas. Verifica tu usuario y contraseña."

```

```yaml
- paragraph: Credenciales incorrectas. Verifica tu usuario y contraseña.
```

# Test source

```ts
  495 |       await expect(this.adminModeButton).toBeVisible();
  496 |       await this.selectAdminMode();
  497 |       await this.usernameInput.fill(credentials.username);
  498 | 
  499 |       // Wrong passwords up to the threshold: the last one locks the account
  500 |       const wrongPassword = this.data.createWrongPassword();
  501 |       for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  502 |         const response = await submitAndWait(wrongPassword);
  503 |         expect(response.status(), `wrong password, attempt ${attempt}`).toBe(401);
  504 |         const bodyText = await response.text();
  505 |         let bodyKeys = 'n/a';
  506 |         try {
  507 |           bodyKeys = Object.keys(JSON.parse(bodyText) as object).join(',');
  508 |         }
  509 |         catch {
  510 |           // Diagnostic only: a non-JSON body must not hide the status assertion above
  511 |         }
  512 |         test.info().annotations.push({
  513 |           type: `wrong-attempt-${attempt}`,
  514 |           description: `max=${maxAttempts} status=${response.status()} backendLocked=${bodyText.includes('ACCOUNT_LOCKED')} keys=${bodyKeys}`,
  515 |         });
  516 |         if (attempt < maxAttempts) {
  517 |           await expect(this.wrongCredentialsMessage).toBeVisible();
  518 |         }
  519 |       }
  520 |       await expect(this.accountLockedMessage).toBeVisible();
  521 |       await expect(this.page).toHaveURL(/\/login$/);
  522 | 
  523 |       // The CORRECT password is rejected with the same lock message
  524 |       const lockedResponse = await submitAndWait(credentials.password);
  525 |       expect(lockedResponse.status(), 'correct password on a locked account').toBe(401);
  526 |       expect(await lockedResponse.text()).toContain('ACCOUNT_LOCKED');
  527 |       await expect(this.accountLockedMessage).toBeVisible();
  528 |       await expect(this.page).toHaveURL(/\/login$/);
  529 | 
  530 |       const cookies = await this.page.context().cookies();
  531 |       expect(cookies.map(c => c.name)).not.toContain('access_token');
  532 |       bodyPassed = true;
  533 |     }
  534 |     finally {
  535 |       limiter.stop();
  536 |       await this.releaseLimiterAfterBody(limiter.lastAt, bodyPassed);
  537 |     }
  538 |   }
  539 | 
  540 |   /**
  541 |    * ATC AUT-038: when the login call is answered with `CRYPTO_SESSION_EXPIRED`,
  542 |    * the SPA must ask the user to repeat the action, not claim the credentials
  543 |    * are wrong, and must open a fresh crypto session (new handshake).
  544 |    *
  545 |    * IMPORTANT: Call goto() before this ATC. Credentials MUST be generated and
  546 |    * non-existent; never the real account. The expired session is simulated by
  547 |    * rewriting `X-Session-Id` of the FIRST login call to an unknown id (the real
  548 |    * 30-minute expiry is not reproduced). One rejected login: the limiter window
  549 |    * is waited out in `finally`. HAL-51: today the SPA shows "Credenciales
  550 |    * incorrectas", so this ATC is expected to fail until that is fixed.
  551 |    *
  552 |    * @param credentials - Generated credentials that do not exist
  553 |    */
  554 |   @atc('AUT-038')
  555 |   async retryAfterCryptoSessionExpired(credentials: LoginCredentials): Promise<void> {
  556 |     const isLoginCall = (response: Response) =>
  557 |       response.request().method() === 'POST' && /\/api\/auth\/login\//i.test(response.url());
  558 |     const handshakes: string[] = [];
  559 |     const onRequest = (request: Request) => {
  560 |       if (request.method() === 'POST' && /\/api\/handshake/i.test(request.url())) {
  561 |         handshakes.push(request.url());
  562 |       }
  563 |     };
  564 |     let rewritten = false;
  565 |     // Handshakes seen up to the moment the expired-session answer arrived: only a later one proves the SPA recovered
  566 |     let handshakesAtExpiry: number | undefined;
  567 |     let bodyPassed = false;
  568 |     const limiter = this.watchRejectedLogins();
  569 |     const onExpiredAnswer = (response: Response) => {
  570 |       if (isLoginCall(response) && response.status() === 401) {
  571 |         handshakesAtExpiry ??= handshakes.length;
  572 |       }
  573 |     };
  574 |     this.page.on('response', onExpiredAnswer);
  575 | 
  576 |     await this.page.route('**/api/auth/login/**', async (route) => {
  577 |       if (rewritten) {
  578 |         await route.continue();
  579 |         return;
  580 |       }
  581 |       rewritten = true;
  582 |       await route.continue({ headers: { ...route.request().headers(), 'x-session-id': [redacted]
  583 |     });
  584 |     this.page.on('request', onRequest);
  585 | 
  586 |     try {
  587 |       await this.selectAdminMode();
  588 |       await this.fillAdminForm(credentials);
  589 |       const [response] = await Promise.all([this.page.waitForResponse(isLoginCall), this.submitButton.click()]);
  590 |       test.info().annotations.push({ type: 'login-status', description: String(response.status()) });
  591 |       expect(response.status()).toBe(401);
  592 |       expect(await response.text()).toContain('CRYPTO_SESSION_EXPIRED');
  593 | 
  594 |       // Correct behaviour: ask to repeat, never "wrong credentials"
> 595 |       await expect(this.formErrorMessage).toHaveText('La sesión de cifrado expiró. Por favor, repite la acción.');
      |                                           ^ Error: expect(locator).toHaveText(expected) failed
  596 |       await expect(this.repeatActionMessage).toBeVisible();
  597 |       await expect(this.wrongCredentialsMessage).toHaveCount(0);
  598 |       await expect(this.page).toHaveURL(/\/login$/);
  599 | 
  600 |       // A fresh crypto session was opened AFTER the expiry answer (a lazy handshake before the submit does not count)
  601 |       expect(handshakesAtExpiry, 'the expired-session answer was observed').toBeDefined();
  602 |       await expect.poll(() => handshakes.length - (handshakesAtExpiry as number), { timeout: 5000 })
  603 |         .toBeGreaterThan(0);
  604 |       bodyPassed = true;
  605 |     }
  606 |     finally {
  607 |       this.page.off('request', onRequest);
  608 |       this.page.off('response', onExpiredAnswer);
  609 |       limiter.stop();
  610 |       await this.page.unroute('**/api/auth/login/**');
  611 |       await this.releaseLimiterAfterBody(limiter.lastAt, bodyPassed);
  612 |     }
  613 |   }
  614 | 
  615 |   /**
  616 |    * ATC AUT-034: after 15 minutes without activity the SPA signs the user out
  617 |    * on its own and leaves them on the login screen.
  618 |    *
  619 |    * Scope: the CLIENT inactivity timer (a 15 min setTimeout in the SPA) under
  620 |    * Playwright's clock control. It does NOT wait 15 real minutes and does NOT
  621 |    * prove server-side token revocation. Under the fast-forwarded clock the
  622 |    * X-Timestamp of the logout call is far ahead of the server's, so the server
  623 |    * rejects that logout: each run leaves one admin server session alive (a 7-day
  624 |    * refresh token) and server-side revocation is NOT exercised by this case.
  625 |    *
  626 |    * Do NOT call goto() before this ATC: the clock must be installed before the
  627 |    * SPA boots, so the ATC navigates by itself. Needs a signed-out context
  628 |    * (own login, never the shared saved session).
  629 |    *
  630 |    * @param credentials - Administrator user name and password
  631 |    */
  632 |   @atc('AUT-034')
  633 |   async logoutAfterInactivity(credentials: LoginCredentials): Promise<void> {
  634 |     const logoutRequests: string[] = [];
  635 |     const isLogoutRequest = (request: Request) =>
  636 |       request.method() === 'POST' && /\/api\/auth\/logout/i.test(request.url());
  637 |     const onRequest = (request: Request) => {
  638 |       if (isLogoutRequest(request)) {
  639 |         logoutRequests.push(request.url());
  640 |       }
  641 |     };
  642 |     this.page.on('request', onRequest);
  643 | 
  644 |     try {
  645 |       await this.page.clock.install();
  646 |       await this.goto();
  647 |       await this.selectAdminMode();
  648 |       await this.fillAdminForm(credentials);
  649 |       await this.submitButton.click();
  650 |       await expect(this.page).toHaveURL(/\/dashboard$/);
  651 |       await expect(this.dashboardHeading).toBeVisible();
  652 | 
  653 |       // Just before the limit (real time keeps flowing, hence the margin): still signed in
  654 |       await this.page.clock.fastForward('14:00');
  655 |       await expect(this.page).toHaveURL(/\/dashboard$/);
  656 |       expect(logoutRequests).toHaveLength(0);
  657 |       expect(await this.hasUiSession()).toBe(true);
  658 | 
  659 |       // Past the limit: the timer fires and the SPA signs out
  660 |       const [response] = await Promise.all([
  661 |         this.page.waitForResponse(
  662 |           response => response.request().method() === 'POST' && /\/api\/auth\/logout/i.test(response.url()),
  663 |         ),
  664 |         this.page.clock.fastForward('01:30'),
  665 |       ]);
  666 |       test.info().annotations.push({ type: 'logout-response-status', description: String(response.status()) });
  667 | 
  668 |       await expect(this.page).toHaveURL(/\/login$/);
  669 |       await expect(this.adminModeButton).toBeVisible();
  670 |       await expect.poll(async () => this.hasUiSession()).toBe(false);
  671 | 
  672 |       // A protected route no longer opens
  673 |       await this.page.goto(this.buildUrl('/dashboard'));
  674 |       await expect(this.page).toHaveURL(/\/login$/);
  675 |     }
  676 |     finally {
  677 |       this.page.off('request', onRequest);
  678 |     }
  679 |   }
  680 | 
  681 |   /**
  682 |    * ATC AUT-004: a valid UserApp signs in through the tenant form and lands on
  683 |    * its log screen with a live session.
  684 |    *
  685 |    * IMPORTANT: Call goto() before this ATC. Needs a signed-out context and a
  686 |    * generated UserApp (never the real account). The tenant form has the same
  687 |    * two fields as the admin one, so the admin fill helper is reused.
  688 |    *
  689 |    * @param credentials - Generated UserApp user name and password
  690 |    */
  691 |   @atc('AUT-004')
  692 |   async loginAsUserAppSuccessfully(credentials: LoginCredentials): Promise<void> {
  693 |     await this.selectTenantMode();
  694 |     await this.fillAdminForm(credentials);
  695 |     await this.submitButton.click();
```