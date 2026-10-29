/**
 * KATA Architecture - Layer 3: Tenants API Component
 *
 * Test-data helpers for generated tenants (ADR-0019). No ATC lives here: the
 * Administrator creates and removes the tenant that owns a generated UserApp.
 * The tenant database coordinates are fabricated; the backend does not check
 * connectivity on creation. Deletion is soft.
 *
 * Endpoints (relative to config.apiUrl, encrypted):
 * - GET    /Tenant/{id}   - read one
 * - POST   /Tenant        - create (SuperAdminSistema)
 * - DELETE /Tenant/{id}   - soft delete
 */

import type { APIResponse } from '@playwright/test';
import type { ApiEnvelope, CreatedEntityData, CreateTenantPayload } from '@schemas/auth.types';
import type { TenantReadData, UpdateTenantPayload } from '@schemas/security.types';

import { SecureApi } from '@api/SecureApi';
import { expect } from '@playwright/test';
import { step } from '@utils/decorators';

export class TenantsApi extends SecureApi {
  /**
   * Create a tenant. Fixed assertions: 200, `Ok`, an id in `Data`.
   * Deliberately NOT a `@step`: step titles print their arguments and the
   * payload carries `DbPassword`, which the decorator does not mask.
   */
  async createTenant(payload: CreateTenantPayload): Promise<[APIResponse, ApiEnvelope<CreatedEntityData>]> {
    const [response, body] = await this.securePOST<CreatedEntityData, CreateTenantPayload>('/Tenant', payload);

    expect(response.status(), `create tenant: ${body.CodeError ?? 'no error code'} ${body.Error ?? ''}`).toBe(200);
    expect(body.Ok).toBe(true);
    expect(body.Data?.Id).toBeGreaterThan(0);

    return [response, body];
  }

  /**
   * Update a generated tenant (audit cases). Fixed assertions: 200, `Ok`.
   * NOT a `@step`: the payload type can carry `DbPassword`.
   */
  async updateTenant(tenantId: number, payload: UpdateTenantPayload): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.securePUT<unknown, UpdateTenantPayload>(`/Tenant/${tenantId}`, payload);

    expect(response.status(), `update tenant: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }

  /** Read one tenant (`GET /Tenant/{id}`); asserts nothing. `Data` carries `MainOperatorId` (OPE cases). */
  async getTenant(tenantId: number): Promise<[APIResponse, ApiEnvelope<TenantReadData>]> {
    return this.secureGET<TenantReadData>(`/Tenant/${tenantId}`);
  }

  /** Soft-delete a tenant. Fixed assertions: 200, `Ok`. */
  @step
  async deleteTenant(tenantId: number): Promise<[APIResponse, ApiEnvelope<unknown>]> {
    const [response, body] = await this.secureDELETE<unknown>(`/Tenant/${tenantId}`);

    expect(response.status(), `delete tenant: ${body.CodeError ?? 'no error code'}`).toBe(200);
    expect(body.Ok).toBe(true);

    return [response, body];
  }
}
