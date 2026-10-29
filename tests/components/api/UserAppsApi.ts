/**
 * KATA Architecture - Layer 3: UserApps API Component
 *
 * Test-data helpers for generated UserApps (ADR-0019). `createUserApp`,
 * `setUserAppActive` and `deleteUserApp` carry no ATC. `unlockUserApp` is a
 * step helper; the case that is itself the unlock (AUT-011, `unlockLockedUserApp`)
 * wraps it. Deletion is soft.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - POST   /tenants/{tenantId}/appusers               - create
 * - PUT    /tenants/{tenantId}/appusers/{id}          - update (IsActive)
 * - DELETE /tenants/{tenantId}/appusers/{id}          - soft delete
 * - PATCH  /tenants/{tenantId}/appusers/{id}/unlock   - clear a lockout
 */

import type { APIResponse } from '@playwright/test';
import type {
  ApiEnvelope,
  CreatedEntityData,
  CreateUserAppPayload,
  LoginPayload,
  UpdateUserAppPayload,
} from '@schemas/auth.types';

import { AuthApi } from '@api/AuthApi';
import { SecureApi } from '@api/SecureApi';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { atc, step } from '@utils/decorators';

/** A generated UserApp and the tenant it belongs to (flat: the step decorator masks `password`). */
export interface LockedUserApp {
  tenantId: number
  userAppId: number
  username: string
  password: string
}

export class UserAppsApi extends SecureApi {
  /** Create a UserApp in a tenant. Fixed assertions: 200, `Ok`, an id in `Data`. Step title masks `Password`. */
  @step
  async createUserApp(
    tenantId: number,
    payload: CreateUserAppPayload,
  ): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateUserAppPayload>(
      `/tenants/${tenantId}/appusers`,
      payload,
    );

    expect(response.status(), `create userapp: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /** Activate or deactivate a UserApp. Fixed assertions: 200, `Ok`. */
  @step
  async setUserAppActive(
    target: { tenantId: number, userAppId: number, isActive: boolean },
  ): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const { tenantId, userAppId, isActive } = target;
    const [response, body] = await this.securePUT<unknown, UpdateUserAppPayload>(
      `/tenants/${tenantId}/appusers/${userAppId}`,
      { IsActive: isActive },
    );

    expect(response.status(), `update userapp: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Soft-delete a UserApp. Fixed assertions: 200, `Ok`. */
  @step
  async deleteUserApp(tenantId: number, userAppId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.secureDELETE<unknown>(`/tenants/${tenantId}/appusers/${userAppId}`);

    expect(response.status(), `delete userapp: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Clear the lockout of a UserApp. Fixed assertions: 200, `Ok`. Step of AUT-011 (run by the Administrator session). */
  @step
  async unlockUserApp(tenantId: number, userAppId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.securePATCH<unknown>(`/tenants/${tenantId}/appusers/${userAppId}/unlock`);

    expect(response.status(), `unlock userapp: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /**
   * One encrypted tenant login on the CURRENT crypto session. Returns the raw
   * answer so the caller decides what to assert. Undecorated: the payload
   * carries a password and the body (on success) carries session tokens.
   */
  private async tenantLogin(credentials: LoginPayload): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    return this.securePOST<unknown, LoginPayload>(this.tenantLoginEndpoint, credentials);
  }

  /** Sign out and open a NEW crypto session (logout drops the previous one). */
  private async signOutAndReopenSession(): Promise<void> {
    const [response, body] = await this.postLogout();
    expect(response.status()).toBe(200);
    expect(body.Ok).toBe(true);
    await this.openCryptoSession();
  }

  /**
   * Unlock a UserApp as the platform Administrator in a SEPARATE request
   * context (own cookie jar and crypto session), so the tenant-user session of
   * the ATC and the shared administrator session are both left alone. Always
   * signs out and disposes the context.
   */
  private async unlockAsAdministrator(tenantId: number, userAppId: number): Promise<void> {
    const adminContext = await playwrightRequest.newContext({ ignoreHTTPSErrors: true });
    const adminAuth = new AuthApi({ request: adminContext });
    try {
      const [, , session] = await adminAuth.startAdminSession({
        UserName: this.config.testUser.email,
        Password: this.config.testUser.password,
      });
      const adminUserApps = new UserAppsApi({ request: adminContext });
      adminUserApps.setCryptoSession(session);
      await adminUserApps.unlockUserApp(tenantId, userAppId);
    }
    finally {
      await adminAuth.logout().catch(() => undefined);
      await adminContext.dispose().catch(() => undefined);
    }
  }

  /**
   * Wait until the address limiter window (4 failed logins in 30 s) has cleared.
   * Condition-based on elapsed time (~31 s from the LAST failure), never a fixed sleep.
   */
  private async releaseLimiterWindow(lastFailureAt: number | undefined): Promise<void> {
    if (lastFailureAt === undefined) {
      return;
    }
    await expect.poll(() => Date.now() - lastFailureAt, { timeout: 35000, intervals: [500] })
      .toBeGreaterThanOrEqual(31000);
  }

  /**
   * AUT-011: after the Administrator unlocks a locked UserApp it can sign in again.
   *
   * The caller passes a GENERATED UserApp whose tenant has a failed-login limit
   * of 3, on an empty cookie jar (own session). Flow: a correct tenant login
   * proves the account works (positive control) and is signed out; three wrong
   * passwords lock it (the third answer is 401 ACCOUNT_LOCKED, below the address
   * limiter of 4 failures / 30 s); the Administrator calls
   * `PATCH /tenants/{id}/appusers/{id}/unlock`; the correct login answers 200 and
   * issues the session cookies. Wrong passwords never reach the real account. The
   * limiter window is waited out in `finally`, measured from the LAST wrong
   * login. That wait (~31 s) plus the flow exceeds the global 60 s timeout, so the
   * spec sets its own.
   */
  @atc('AUT-011')
  async unlockLockedUserApp(userApp: LockedUserApp): Promise<void> {
    const correct: LoginPayload = { UserName: userApp.username, Password: userApp.password };
    const wrong: LoginPayload = { UserName: userApp.username, Password: this.data.createWrongPassword() };
    let lastFailureAt: number | undefined;
    let bodyPassed = false;
    let releaseError: unknown;

    try {
      await this.openCryptoSession();
      await this.signInTenantUser(correct);
      await this.signOutAndReopenSession();

      const expectedCodes = ['INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED'];
      for (const expectedCode of expectedCodes) {
        const [response, body] = await this.tenantLogin(wrong);
        lastFailureAt = Date.now();
        expect(response.status()).toBe(401);
        expect(body.CodeError).toBe(expectedCode);
      }

      await this.unlockAsAdministrator(userApp.tenantId, userApp.userAppId);

      await this.signInTenantUser(correct);
      bodyPassed = true;
    }
    finally {
      await this.postLogout().catch(() => undefined);
      try {
        await this.releaseLimiterWindow(lastFailureAt);
      }
      catch (error) {
        releaseError = error;
        if (!bodyPassed) {
          // A failed body keeps its own error; leave a note instead
          test.info().annotations.push({ type: 'release-failed', description: 'address limiter window not confirmed released' });
        }
      }
    }
    // Reached only when the body passed: then a release failure is the failure
    if (releaseError !== undefined) {
      throw releaseError;
    }
  }
}
