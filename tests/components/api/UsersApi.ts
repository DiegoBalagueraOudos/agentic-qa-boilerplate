/**
 * KATA Architecture - Layer 3: Users API Component
 *
 * Test-data helpers for generated platform Admins (ADR-0019): non-root accounts
 * created with a chosen password so negative login cases never touch the real
 * Administrator. No ATC lives here. Deletion is soft.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - POST   /User        - create a platform Admin
 * - DELETE /User/{id}   - soft delete
 * - GET    /SecurityConfig/lockout - global Admin lockout threshold (read only)
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreateAdminPayload, CreatedEntityData, LockoutConfigData } from '@schemas/auth.types';

import { SecureApi } from '@api/SecureApi';
import { expect } from '@playwright/test';
import { step } from '@utils/decorators';

export class UsersApi extends SecureApi {
  /** Create a platform Admin. Fixed assertions: 200, `Ok`, an id in `Data`. Step title masks `Password`. */
  @step
  async createAdmin(payload: CreateAdminPayload): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateAdminPayload>('/User', payload);

    expect(response.status(), `create admin: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /**
   * Read the GLOBAL failed-login threshold of platform Admins (read only).
   * Fixed assertions: 200, `Ok`, a positive integer in `Data`.
   */
  @step
  async getAdminLockoutThreshold(): Promise<[APIResponse, ApiEnvelope<LockoutConfigData>]> {
    const [response, body] = await this.secureGET<LockoutConfigData>('/SecurityConfig/lockout');

    expect(response.status(), `read lockout config: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.MaxFailedLoginAttempts).toBeGreaterThanOrEqual(1);

    return [response, body];
  }

  /** Soft-delete a platform Admin. Fixed assertions: 200, `Ok`. */
  @step
  async deleteAdmin(userId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.secureDELETE<unknown>(`/User/${userId}`);

    expect(response.status(), `delete admin: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }
}
