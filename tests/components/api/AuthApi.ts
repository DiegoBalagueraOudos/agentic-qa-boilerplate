/**
 * KATA Architecture - Layer 3: Auth API Component
 *
 * Session plumbing for the Validate API (ADR-0018): opens the encrypted session
 * and signs in as the platform administrator. The tenant sign-in, the logout and
 * the sanitised-error wrapper shared with the other components live in SecureApi. `startAdminSession`,
 * `verifySessionAuthorized` and `logout` are `@step` helpers, not ATCs: they exist
 * so `api-setup` and API specs have an authenticated context. The one ATC here is
 * AUT-039 (refresh token reused after logout); `refreshWithToken` and the other
 * private helpers carry secrets and have no decorator. The behaviour of the login
 * itself (AUT-002, AUT-007...) is owned by the ATCs that exercise it.
 *
 * Endpoints (relative to config.apiUrl):
 * - POST /handshake          - open the ECDH session (answered in the clear)
 * - POST /Auth/login/admin   - encrypted body; sets access_token, refresh_token, csrf_token cookies
 * - GET  /Tenant             - used only to prove the session is authorized
 * - POST /Auth/logout        - encrypted body `{}`; revokes the refresh token, clears the cookies
 * - POST /Auth/refresh       - encrypted body `{}`; reads only the `refresh_token` cookie
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, AuthData, LoginPayload } from '@schemas/auth.types';
import type { CryptoSessionState } from '@utils/cryptoSession';

import { SecureApi } from '@api/SecureApi';
import { expect, request as playwrightRequest } from '@playwright/test';
import { atc, step } from '@utils/decorators';

// Re-export types for consumers that import from AuthApi
export type { ApiEnvelope, AuthData, LoginPayload } from '@schemas/auth.types';

const REFRESH_ENDPOINT = '/Auth/refresh';

export class AuthApi extends SecureApi {
  /**
   * Open a crypto session and sign in as the platform administrator.
   *
   * Fixed assertions: 200, `Ok`, an `Admin` user type, and the three session
   * cookies present. Tokens are never read from the body; the cookies are the
   * session.
   *
   * @returns The login response and the crypto session to persist for later processes
   */
  @step
  async startAdminSession(
    credentials: LoginPayload,
  ): Promise<[APIResponse, ApiEnvelope<AuthData>, CryptoSessionState]> {
    const session = await this.openCryptoSession();
    const [response, body] = await this.securePOST<AuthData, LoginPayload>(
      this.config.auth.adminLoginEndpoint,
      credentials,
    );

    expect(response.status()).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.UserType).toBe('Admin');

    const { cookies } = await this.request.storageState();
    expect(cookies.map(c => c.name)).toEqual(expect.arrayContaining(this.sessionCookies));
    expect(cookies.find(c => c.name === 'access_token')?.httpOnly).toBe(true);

    return [response, body, session];
  }

  /**
   * Prove the current session is authorized: a read-only, encrypted GET that
   * answers 401 without a valid cookie. Needs the session cookies AND the
   * crypto session, so it fails if either half was lost between processes.
   */
  @step
  async verifySessionAuthorized(): Promise<void> {
    const [response, body] = await this.secureGET<{ Data: unknown[] }>('/Tenant?Page=1&PageSize=1');

    expect(response.status()).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Data).toBeDefined();
  }

  /** Sign out the current session: encrypted `{}` body, revokes the refresh token. */
  @step
  async logout(): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.postLogout();
  }

  /**
   * Ask for a new session with an EXPLICIT refresh token instead of the one in
   * the cookie jar. The server reads only the `refresh_token` cookie, so the
   * value travels as a `Cookie` header (set on the shared default headers for
   * this one call only and always removed). Deliberately NOT a `@step`: step
   * titles print their arguments and the token is a secret. Errors go through
   * `withSecretGuard` (no call log, no headers, no token).
   */
  private async refreshWithToken(refreshToken: string): Promise<[APIResponse, ApiEnvelope<AuthData>]> {
    this.requestHeaders.Cookie = `refresh_token=${refreshToken}`;
    try {
      return await this.withSecretGuard('refresh', 'token', async () =>
        this.securePOST<AuthData, Record<string, never>>(REFRESH_ENDPOINT, {}));
    }
    finally {
      delete this.requestHeaders.Cookie;
    }
  }

  /** The `refresh_token` cookie value currently in this component's jar (a secret: never log it). */
  private async currentRefreshToken(): Promise<string | undefined> {
    const { cookies } = await this.request.storageState();
    return cookies.find(c => c.name === 'refresh_token')?.value;
  }

  /**
   * Positive control for AUT-039: a LIVE refresh token replayed through the same
   * explicit-Cookie mechanism must be accepted (200, Ok), so the later 401 means
   * "revoked" and not "mangled / unknown". The token comes from a second
   * disposable admin session (own cookie jar, own crypto session); the replay
   * goes through this component's clean jar with a fresh crypto session. Both
   * sessions are signed out afterwards, tolerating cleanup errors.
   */
  private async assertLiveRefreshTokenIsAccepted(credentials: LoginPayload): Promise<void> {
    const controlContext = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    const control = new AuthApi({ request: controlContext });
    try {
      await control.startAdminSession(credentials);
      const liveToken = await control.currentRefreshToken();
      expect(liveToken, 'refresh_token cookie issued by the control login').toBeTruthy();

      await this.openCryptoSession();
      const [response, body] = await this.refreshWithToken(liveToken as string);
      expect(response.status()).toBe(200);
      expect(body.Ok).toBe(true);
    }
    finally {
      // Cleanup: neither the refreshed session (this jar) nor the control one may stay alive
      await this.logout().catch(() => undefined);
      await control.logout().catch(() => undefined);
      await controlContext.dispose().catch(() => undefined);
    }
  }

  /**
   * AUT-039: a refresh token captured before logout is rejected after logout.
   *
   * Runs on its OWN session (the caller starts from an empty cookie jar). First a
   * positive control proves the explicit-Cookie replay delivers a valid token
   * (200); then: sign in, keep the refresh token in memory, sign out, open a NEW
   * crypto session (logout drops the old one; without it the rejection would be
   * a false positive, CRYPTO_SESSION_EXPIRED), then replay the old token.
   */
  @atc('AUT-039')
  async reuseRefreshTokenAfterLogout(
    credentials: LoginPayload,
  ): Promise<[APIResponse, ApiEnvelope<AuthData>]> {
    await this.assertLiveRefreshTokenIsAccepted(credentials);

    await this.startAdminSession(credentials);
    const refreshToken = await this.currentRefreshToken();
    expect(refreshToken, 'refresh_token cookie issued by the login').toBeTruthy();

    const [logoutResponse, logoutBody] = await this.logout();
    expect(logoutResponse.status()).toBe(200);
    expect(logoutBody.Ok).toBe(true);

    await this.openCryptoSession();
    const [response, body] = await this.refreshWithToken(refreshToken as string);

    expect(response.status()).toBe(401);
    expect(body.Ok).toBe(false);
    expect(body.CodeError).toBe('INVALID_CREDENTIALS');
    expect(body.Error).toMatch(/Sesi.n expirada/);
    expect(body.Data).toBeNull();

    const { cookies: after } = await this.request.storageState();
    expect(after.map(c => c.name)).not.toContain('access_token');
    expect(after.map(c => c.name)).not.toContain('refresh_token');

    return [response, body];
  }
}
