/**
 * KATA Framework - Type Facade: Auth Domain
 *
 * Request DTOs come from the OpenAPI contract (`bun run api:sync`). The
 * contract declares NO response body for the auth routes, so the response
 * shapes below are written by hand from the live wire format. They are PascalCase
 * because the backend serializes the encrypted payload without the camelCase
 * policy the rest of its pipeline applies (see ADR-0018).
 *
 * The generated-principal DTOs (tenant, platform Admin, UserApp: ADR-0019) live here too,
 * because they are only used to create test data for the login cases.
 *
 * Consumed by: tests/components/api/{SecureApi,AuthApi,TenantsApi,UsersApi,UserAppsApi}.ts,
 * tests/data/DataFactory.ts
 */

import type { components } from '@openapi';

// ============================================================================
// Request DTOs (from the contract)
// ============================================================================

/** POST /api/Auth/login/admin and /api/Auth/login/tenant */
export type LoginPayload = components['schemas']['LoginDto'];

/** POST /api/handshake */
export type HandshakeRequest = components['schemas']['HandshakeRequestDto'];

/** POST /api/Tenant */
export type CreateTenantPayload = components['schemas']['CreateTenantDto'];

/** POST /api/User (non-root platform Admin) */
export type CreateAdminPayload = components['schemas']['CreateUserDto'];

/** POST /api/tenants/{tenantId}/appusers */
export type CreateUserAppPayload = components['schemas']['CreateUserAppDto'];

/** PUT /api/tenants/{tenantId}/appusers/{id} */
export type UpdateUserAppPayload = components['schemas']['UpdateUserAppDto'];

/** POST /api/tenants/{tenantId}/tenant-admins (the backend generates the temporary password and the activation token) */
export type CreateTenantAdminPayload = components['schemas']['CreateTenantAdminDto'];

/** PUT /api/tenants/{tenantId}/tenant-admins/{id} (all fields optional: name, position, password, status) */
export type UpdateTenantAdminPayload = components['schemas']['UpdateTenantAdminDto'];

/** POST /api/Auth/tenant-admin/activate (anonymous): the token from the welcome mail and the new password */
export type ActivateAccountPayload = components['schemas']['ActivateAccountDto'];

/** POST /api/Auth/tenant-admin/resend-activation (anonymous) */
export type ResendActivationPayload = components['schemas']['ResendActivationDto'];

// ============================================================================
// Response shapes (hand-written; the contract has no response content)
// ============================================================================

/** The envelope every route answers with. `Data` is null on failure. */
export interface ApiEnvelope<T> {
  Ok: boolean
  CodeError: string | null
  Error: string | null
  ValidationErrors: unknown[]
  Data: T | null
  Warning: string | null
}

/** POST /api/handshake. Answered in the clear: it is the call that opens the session. */
export interface HandshakeData {
  SessionId: string
  /** Server ECDH P-256 public key, SPKI DER, base64. */
  ServerPublicKey: string
}

/**
 * POST /api/Auth/login/admin. `Token` and `RefreshToken` are secrets: the same
 * values already travel as HttpOnly cookies, and tests assert on the cookies.
 */
export interface AuthData {
  Token: string
  RefreshToken: string
  UserType: string
  UserId: number
  UserName: string
  RoleName: string | null
  FullName: string | null
  TenantId: number | null
  TenantName: string | null
  TenantLogo: string | null
  MustChangePassword: boolean
  IsRoot: boolean
}

/** GET /api/SecurityConfig/lockout: the global failed-login threshold of platform Admins. */
export interface LockoutConfigData {
  MaxFailedLoginAttempts: number
}

/** What the create routes (tenant, platform Admin, UserApp) answer in `Data`; only the id is used. */
export interface CreatedEntityData {
  Id: number
}

/** What POST /api/tenants/{tenantId}/tenant-admins answers in `Data`. The token and the password are NOT in it (they travel only by e-mail). */
export interface TenantAdminData {
  Id: number
  MustChangePassword: boolean
  PendingActivation: boolean
}

/**
 * GET /api/tenants/{tenantId}/tenant-admins[/{id}]: the full record the list and the read
 * answer with (the create answer is the short `TenantAdminData`). No secret in it.
 */
export interface TenantAdminRecord {
  Id: number
  TenantId: number
  UserName: string
  FullName: string | null
  Position: string | null
  IsActive: boolean
  IsLockedOut: boolean
  FailedLoginAttempts: number
  MustChangePassword: boolean
  PendingActivation: boolean
  CreatedAt: string
  CreatedBy: string
  UpdatedAt: string | null
  UpdatedBy: string | null
  TenantName: string | null
}
