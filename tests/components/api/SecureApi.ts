/**
 * KATA Architecture - Layer 2: Secure API Base Component
 *
 * ApiBase variant for the Validate API (ADR-0018). Twelve route prefixes carry
 * AES-256-GCM envelopes keyed by an ECDH handshake, and the session itself is a
 * pair of HttpOnly cookies plus a double-submit CSRF token. Domain components
 * extend this class instead of ApiBase and call secureGET / securePOST; the
 * handshake, envelope and CSRF header are handled here and never in an ATC.
 *
 * The cookies live in the Playwright request context (`request.storageState()`),
 * so this class holds only what the context cannot: the session id and AES key.
 *
 * Never attaches a decrypted body to Allure: login responses carry tokens.
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, AuthData, HandshakeData, HandshakeRequest, LoginPayload } from '@schemas/auth.types';
import type { RawEnvelopeRequest, RawEnvelopeResult } from '@schemas/security.types';
import type { TestContextOptions } from '@TestContext';
import type { CryptoSessionState, EncryptedEnvelope } from '@utils/cryptoSession';

import { ApiBase } from '@api/ApiBase';
import { expect, test } from '@playwright/test';
import { decryptEnvelope, encryptEnvelope, isEnvelope, startHandshake } from '@utils/cryptoSession';

/** Window of the per-IP failed-login limiter plus a margin, measured from the LAST attempt. */
const LIMITER_WINDOW_MS = 31000;

export class SecureApi extends ApiBase {
  /** Cookies that make up a signed-in session (asserted by NAME only, values are never read). */
  protected readonly sessionCookies = ['access_token', 'refresh_token', 'csrf_token'];
  protected readonly tenantLoginEndpoint = '/Auth/login/tenant';
  protected readonly logoutEndpoint = '/Auth/logout';

  private cryptoState: CryptoSessionState | null = null;

  constructor(options: TestContextOptions) {
    super(options);
  }

  // ============================================
  // Crypto session
  // ============================================

  get cryptoSession(): CryptoSessionState | null {
    return this.cryptoState;
  }

  setCryptoSession(state: CryptoSessionState) {
    this.cryptoState = state;
  }

  clearCryptoSession() {
    this.cryptoState = null;
  }

  /**
   * Open a fresh crypto session: generate a client key pair, POST it to the
   * handshake, derive the shared AES key. Replaces any session held before.
   */
  protected async openCryptoSession(): Promise<CryptoSessionState> {
    const pending = startHandshake();
    const [response, body] = await this.withSecretGuard('handshake', 'session', async () =>
      this.apiPOST<ApiEnvelope<HandshakeData>, HandshakeRequest>(
        this.config.auth.handshakeEndpoint,
        { ClientPublicKey: pending.clientPublicKey },
      ));
    const data = body.Data;
    if (!response.ok() || !body.Ok || data === null) {
      throw new Error(`Handshake failed: HTTP ${response.status()}, ${body.CodeError ?? 'no error code'}`);
    }

    this.cryptoState = {
      sessionId: data.SessionId,
      aesKey: pending.deriveAesKey(data.ServerPublicKey).toString('base64'),
    };
    return this.cryptoState;
  }

  /** The CURRENT crypto session, or an error telling the caller to open one first (hand-built requests). */
  protected activeSession(): CryptoSessionState {
    if (this.cryptoState === null) {
      throw new Error('No crypto session: open one first');
    }
    return this.cryptoState;
  }

  private requireSession(): CryptoSessionState {
    if (this.cryptoState === null) {
      throw new Error('No crypto session. Run api-setup, or open one with openCryptoSession() first.');
    }
    return this.cryptoState;
  }

  // ============================================
  // Shared session plumbing (undecorated: payloads carry credentials)
  // ============================================

  /**
   * Encrypted tenant-user (UserApp) sign-in on the CURRENT crypto session.
   * Fixed assertions: 200, `Ok` and the three session cookies (by name). Returns
   * the response; the body (tokens) is never logged.
   */
  protected async signInTenantUser(credentials: LoginPayload): Promise<[APIResponse, ApiEnvelope<AuthData>]> {
    const [response, body] = await this.securePOST<AuthData, LoginPayload>(this.tenantLoginEndpoint, credentials);
    expect(response.status(), `tenant login: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    const { cookies } = await this.request.storageState();
    expect(cookies.map(c => c.name)).toEqual(expect.arrayContaining(this.sessionCookies));
    return [response, body];
  }

  /**
   * Encrypted platform-Administrator sign-in on the CURRENT crypto session.
   * Fixed assertions: 200, `Ok` and the three session cookies (by name). Returns
   * the response; the body (tokens) is never logged.
   */
  protected async signInAdministrator(credentials: LoginPayload): Promise<[APIResponse, ApiEnvelope<AuthData>]> {
    const [response, body] = await this.securePOST<AuthData, LoginPayload>(this.config.auth.adminLoginEndpoint, credentials);
    expect(response.status(), `admin login: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    const { cookies } = await this.request.storageState();
    expect(cookies.map(c => c.name)).toEqual(expect.arrayContaining(this.sessionCookies));
    return [response, body];
  }

  /** Open an own crypto session and sign in ONCE as the Administrator (a positive login). */
  protected async openAdministratorSession(): Promise<ApiEnvelope<AuthData>> {
    await this.openCryptoSession();
    const [, body] = await this.signInAdministrator({
      UserName: this.config.testUser.email,
      Password: this.config.testUser.password,
    });
    return body;
  }

  /**
   * Encrypted logout (`{}` body): the server revokes the refresh token, clears
   * the cookies and drops the crypto session. The CLIENT state held here
   * (session id and AES key) is NOT cleared: callers may still need it to prove
   * what the server now refuses; call `clearCryptoSession()` to drop it.
   */
  protected async postLogout(): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePOST<unknown, Record<string, never>>(this.logoutEndpoint, {});
  }

  /**
   * Run a request that carries a secret (session headers, CSRF token, cookies,
   * Bearer token, refresh cookie) and never let that secret leak through the
   * error. Every secure* method and the handshake go through here. Playwright prints a 'Call
   * log' with the request headers on a transport failure, so:
   * - a transport failure (ECONNRESET, timeout, apiRequestContext) is replaced by a
   *   NEW error: same name, a short cause code, no call log, no headers, no `cause`;
   * - any other failure (decrypt, JSON, 'No crypto session') keeps its meaning as a
   *   new error with only its name and first line (truncated), no stack, no `cause`.
   */
  protected async withSecretGuard<T>(what: string, secretLabel: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    }
    catch (error) {
      const raw = error as { name?: unknown, code?: unknown, message?: unknown };
      const message = typeof raw.message === 'string' ? raw.message : '';
      const firstLine = message.split(/\r?\n/)[0];
      const name = typeof raw.name === 'string' ? raw.name : 'Error';
      const text = `${typeof raw.code === 'string' ? raw.code : ''} ${firstLine}`;
      const isTransport = /Call log|apiRequestContext\./.test(message)
        || /\b(?:ECONN[A-Z]*|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN)\b/.test(text)
        || /timeout/i.test(text);
      if (!isTransport) {
        const safe = new Error(`${what} request failed (${name}): ${firstLine.slice(0, 120)}`);
        safe.name = name;
        throw safe;
      }
      const cause = /E[A-Z]{3}[A-Z_]*/.exec(text)?.[0] ?? (/timeout/i.test(text) ? 'timeout' : 'unknown');
      const sanitized = new Error(`${what} request failed on transport (${cause}); details withheld to protect the ${secretLabel}`);
      sanitized.name = name;
      throw sanitized;
    }
  }

  // ============================================
  // Failed-login limiter
  // ============================================

  /**
   * Wait until the per-IP failed-login limiter window (4 failures in 30 s) has cleared.
   * Condition-based on elapsed time (~31 s from the LAST attempt), never a fixed sleep.
   */
  protected async awaitLimiterRelease(lastAttemptAt: number | undefined): Promise<void> {
    if (lastAttemptAt === undefined) {
      return;
    }
    await expect.poll(() => Date.now() - lastAttemptAt, { timeout: 35000, intervals: [500] })
      .toBeGreaterThanOrEqual(LIMITER_WINDOW_MS);
  }

  /**
   * The `finally` of an ATC that spent failed logins: sign out, then confirm the limiter window
   * released. Never throws: it RETURNS the release error (undefined when released) so the caller
   * rethrows it AFTER its own `finally`, without hiding the error of the ATC body. When the body
   * did not pass and the release is not confirmed, a `release-failed` annotation is recorded.
   */
  protected async signOutAndReleaseLimiter(lastAttemptAt: number | undefined, bodyPassed: boolean): Promise<unknown> {
    await this.postLogout().catch(() => undefined);
    try {
      await this.awaitLimiterRelease(lastAttemptAt);
    }
    catch (error) {
      if (!bodyPassed) {
        test.info().annotations.push({ type: 'release-failed', description: 'address limiter window not confirmed released' });
      }
      return error;
    }
    return undefined;
  }

  // ============================================
  // Headers
  // ============================================

  /** The double-submit value: the request header must equal the `csrf_token` cookie. */
  protected async csrfHeader(): Promise<Record<string, string>> {
    const { cookies } = await this.request.storageState();
    const token = cookies.find(c => c.name === 'csrf_token')?.value;
    return token === undefined ? {} : { 'X-CSRF-Token': token };
  }

  /** Mutation without a body: session id (the server encrypts the response) plus CSRF. */
  protected async mutationHeaders(session: CryptoSessionState): Promise<Record<string, string>> {
    return { 'X-Session-Id': session.sessionId, ...await this.csrfHeader() };
  }

  /** Mutation with an encrypted body: the nonce is single-use and X-Timestamp must be fresh. */
  protected async envelopeHeaders(session: CryptoSessionState): Promise<Record<string, string>> {
    return { ...await this.mutationHeaders(session), 'X-Timestamp': Date.now().toString() };
  }

  // ============================================
  // Secure HTTP methods
  // ============================================

  /** Decrypts a 2xx envelope. Errors (non-2xx) are answered in the clear and pass through. */
  private decode<T>(session: CryptoSessionState, body: EncryptedEnvelope | ApiEnvelope<T>): ApiEnvelope<T> {
    return isEnvelope(body)
      ? decryptEnvelope<ApiEnvelope<T>>(Buffer.from(session.aesKey, 'base64'), body)
      : body;
  }

  /**
   * The ONE path every secure request travels: requires the crypto session, runs
   * the call under `withSecretGuard` (a transport failure never reaches an error
   * message with X-CSRF-Token, X-Session-Id, cookies or Authorization) and
   * decrypts the answer.
   */
  private async send<T>(
    method: string,
    call: (session: CryptoSessionState) => Promise<readonly [APIResponse, EncryptedEnvelope | ApiEnvelope<T>, ...unknown[]]>,
  ): Promise<[APIResponse, ApiEnvelope<T>]> {
    return this.withSecretGuard(`secure ${method}`, 'session headers', async () => {
      const session = this.requireSession();
      const [response, body] = await call(session);
      return [response, this.decode(session, body)] as [APIResponse, ApiEnvelope<T>];
    });
  }

  /** Encrypt a payload with the CURRENT crypto session (a fresh single-use nonce each call). */
  protected encryptWithSession(payload: object): EncryptedEnvelope {
    return encryptEnvelope(Buffer.from(this.requireSession().aesKey, 'base64'), payload);
  }

  /**
   * Raw send for the transport-level cases: the caller builds the body (an
   * envelope, a tampered one or plaintext) and CHOOSES the headers, including a
   * missing or wrong CSRF token or a replayed or stale timestamp. Nothing is
   * asserted and nothing throws on a 4xx/5xx: it returns the status, the error
   * code, the response headers and the decoded envelope (null when the answer
   * was not an envelope or could not be decrypted). Runs under `withSecretGuard`.
   */
  protected async sendEnvelope(request: RawEnvelopeRequest): Promise<RawEnvelopeResult> {
    const { method, endpoint, body, headers } = request;
    return this.withSecretGuard(`raw ${method}`, 'session headers', async () => {
      const options = { headers };
      let result: readonly [APIResponse, unknown, ...unknown[]];
      switch (method) {
        case 'POST':
          result = await this.apiPOST<unknown, object>(endpoint, body ?? {}, options);
          break;
        case 'PUT':
          result = await this.apiPUT<unknown, object>(endpoint, body ?? {}, options);
          break;
        case 'PATCH':
          result = await this.apiPATCH<unknown, object>(endpoint, body ?? {}, options);
          break;
        case 'DELETE':
          result = await this.apiDELETE<unknown>(endpoint, options);
          break;
        default:
          result = await this.apiGET<unknown>(endpoint, options);
      }
      const [response, answer] = result;

      let decoded: ApiEnvelope<unknown> | null = null;
      if (isEnvelope(answer) && this.cryptoState !== null) {
        try {
          decoded = decryptEnvelope<ApiEnvelope<unknown>>(Buffer.from(this.cryptoState.aesKey, 'base64'), answer);
        }
        catch {
          decoded = null;
        }
      }
      else if (typeof answer === 'object' && answer !== null && 'Ok' in answer) {
        decoded = answer as ApiEnvelope<unknown>;
      }

      return {
        status: response.status(),
        code: decoded?.CodeError ?? null,
        headers: response.headers(),
        decoded,
        rawText: await response.text().catch(() => ''),
      };
    });
  }

  /** GET: only `X-Session-Id` is needed so the server encrypts the response. */
  protected async secureGET<T>(endpoint: string): Promise<[APIResponse, ApiEnvelope<T>]> {
    return this.send<T>('GET', async session =>
      this.apiGET<EncryptedEnvelope | ApiEnvelope<T>>(endpoint, {
        headers: { 'X-Session-Id': session.sessionId },
      }));
  }

  /**
   * POST with an encrypted body. A nonce is single-use and the timestamp must be
   * within 60 s of the server clock, so each call builds a fresh envelope.
   */
  protected async securePOST<T, TPayload extends object>(
    endpoint: string,
    payload: TPayload,
  ): Promise<[APIResponse, ApiEnvelope<T>]> {
    return this.send<T>('POST', async (session) => {
      const envelope = encryptEnvelope(Buffer.from(session.aesKey, 'base64'), payload);
      return this.apiPOST<EncryptedEnvelope | ApiEnvelope<T>, EncryptedEnvelope>(
        endpoint,
        envelope,
        { headers: await this.envelopeHeaders(session) },
      );
    });
  }

  /** PUT with an encrypted body: same envelope rules as securePOST. */
  protected async securePUT<T, TPayload extends object>(
    endpoint: string,
    payload: TPayload,
  ): Promise<[APIResponse, ApiEnvelope<T>]> {
    return this.send<T>('PUT', async (session) => {
      const envelope = encryptEnvelope(Buffer.from(session.aesKey, 'base64'), payload);
      return this.apiPUT<EncryptedEnvelope | ApiEnvelope<T>, EncryptedEnvelope>(
        endpoint,
        envelope,
        { headers: await this.envelopeHeaders(session) },
      );
    });
  }

  /**
   * DELETE has no body, so there is nothing to encrypt: `X-Session-Id` makes the
   * server encrypt the response and the CSRF header is required on mutations.
   */
  protected async secureDELETE<T>(endpoint: string): Promise<[APIResponse, ApiEnvelope<T>]> {
    return this.send<T>('DELETE', async session =>
      this.apiDELETE<EncryptedEnvelope | ApiEnvelope<T>>(endpoint, {
        headers: await this.mutationHeaders(session),
      }));
  }

  /** PATCH without a body (for example `/unlock`): same headers as secureDELETE. */
  protected async securePATCH<T>(endpoint: string): Promise<[APIResponse, ApiEnvelope<T>]> {
    return this.send<T>('PATCH', async session =>
      this.apiPATCH<EncryptedEnvelope | ApiEnvelope<T>, undefined>(
        endpoint,
        undefined,
        { headers: await this.mutationHeaders(session) },
      ));
  }
}
