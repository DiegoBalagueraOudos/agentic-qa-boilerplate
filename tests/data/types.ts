/**
 * KATA Architecture - Test Data Types
 *
 * Types for test data generation and fixture state.
 * These are TEST-ONLY concepts — NOT API contract types.
 *
 * API contract types (request/response schemas) belong in:
 *   api/schemas/{domain}.types.ts → import from '@schemas/{domain}.types'
 */

// ============================================
// Generic Types
// ============================================

export interface TestUser {
  email: string
  password: string
  name: string
  firstName?: string
  lastName?: string
}

export interface TestCredentials {
  email: string
  password: string
}

/**
 * Principals generated through the Administrator API (ADR-0019). Passwords are
 * generated per run, never real; usernames are the login identifiers.
 */
export interface GeneratedPrincipals {
  tenant: { id: number, rnec: string }
  userApp: { id: number, username: string, password: string }
  admin: { id: number, username: string, password: string }
}

/** Hostile operator-name families (SEC cases): XSS vectors for the UI render checks. */
export type HostilePayloadKind = 'img-onerror' | 'script' | 'svg-onload' | 'attribute-break';

/** A generated operator: `code` is the unique `Q` + 8 chars code, `name` starts with `QAX<code>`. */
export interface GeneratedOperator {
  id: number
  code: string
  name: string
  kind: HostilePayloadKind | 'plain'
}

// ============================================
// Auth/Fixture State Types
// ============================================

/**
 * Bearer state written by `bun run api:login` (machine-client flow, deferred).
 * The human admin session is not stored here: see CryptoSessionState in
 * tests/utils/cryptoSession.ts.
 */
export interface ApiState {
  token: string
  tokenType: string
  expiresIn: number
  refreshToken: string | null
  source: 'ui-login' | 'api-login'
  createdAt: string
}

// ============================================
// TenantAdmin input rows (ADM cases)
// ============================================

/** One input row of a rejected-input case: `label` names the row in a failure message (never the value). */
export interface InputRow {
  label: string
  value: string
}

/** A weak password and the rule it breaks (`rule` is what the failure message names; the value never is). */
export interface WeakPasswordRow {
  rule: 'min-length' | 'uppercase' | 'lowercase' | 'digit' | 'empty'
  value: string
}

/** The three operator fields that carry a length limit (OPE cases): code 10, name 150, service URL 500. */
export type OperatorLimitField = 'code' | 'name' | 'url';

/** Over-length `FullName` / `Position`, and the same fields exactly at the allowed limit. */
export interface TenantAdminFieldLengths {
  fullName: string
  position: string
}
