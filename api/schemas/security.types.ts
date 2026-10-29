/**
 * KATA Framework - Type Facade: Security Domain (SEC cases)
 *
 * Request DTOs come from the OpenAPI contract (`bun run api:sync`); the contract
 * declares no response body, so the operator shape is written by hand from the
 * live wire format (PascalCase, ADR-0018).
 *
 * Consumed by: tests/components/api/{SecureApi,OperatorsApi}.ts,
 * tests/components/steps/SecurityDataSteps.ts, tests/data/DataFactory.ts
 */

import type { components } from '@openapi';

// ============================================================================
// Request DTOs (from the contract)
// ============================================================================

/** POST /api/operators */
export type CreateOperatorPayload = components['schemas']['CreateOperatorDto'];

/** PUT /api/operators/{id} */
export type UpdateOperatorPayload = components['schemas']['UpdateOperatorDto'];

/** PUT /api/Tenant/{id} */
export type UpdateTenantPayload = components['schemas']['UpdateTenantDto'];

// ============================================================================
// Response shapes (hand-written)
// ============================================================================

/** The audit fields of a tenant row (read of a generated tenant; `Deleted*` only after a soft delete). */
export interface TenantAuditData {
  Id: number
  Rnec: string
  CreatedBy: string | null
  CreatedAt: string | null
  UpdatedBy: string | null
  UpdatedAt: string | null
  DeletedBy: string | null
  DeletedAt: string | null
  IsDeleted?: boolean
}

/** What /api/operators answers in `Data` (create, read, update). The code is stored upper case. */
export interface OperatorData {
  Id: number
  OperatorCode: string
  OperatorName: string
  ServiceUrl: string | null
  IsActive: boolean
  CreatedAt: string
  CreatedBy: string
  UpdatedAt: string | null
  UpdatedBy: string | null
}

/** What GET /api/Tenant/{id} answers that the OPE cases read: the operator references (no foreign key, may dangle). */
export interface TenantReadData {
  Id: number
  MainOperatorId: number | null
  ContingencyOperatorId: number | null
}

/** A paginated list as the list routes answer in `Data`. */
export interface PagedData<T> {
  Data: T[]
  TotalRecords: number
}

// ============================================================================
// Raw envelope send (transport-level cases)
// ============================================================================

/** Input of `SecureApi.sendEnvelope`: the caller builds the body and chooses every header. */
export interface RawEnvelopeRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  endpoint: string
  /** Envelope, tampered envelope or plaintext object. Ignored for GET and DELETE. */
  body?: object
  headers: Record<string, string>
}

/** What `SecureApi.sendEnvelope` returns: nothing is asserted by the sender. */
export interface RawEnvelopeResult {
  status: number
  /** `CodeError` of the answer when it is an envelope, otherwise null. */
  code: string | null
  /** Response headers, lower-case names. May hold Set-Cookie: never log them whole. */
  headers: Record<string, string>
  /** The decoded envelope, or null when the answer was not one or could not be decrypted. */
  decoded: { Ok: boolean, CodeError: string | null, Error: string | null, Data: unknown } | null
  /**
   * The raw response body text. For in-memory substring search ONLY (an echo check): never log it,
   * never attach it, never put it in a message. Empty when the body cannot be read.
   */
  rawText: string
}
