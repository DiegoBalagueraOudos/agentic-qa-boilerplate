/**
 * KATA Framework - OpenAPI Type Facades (Barrel Export)
 *
 * Re-exports all domain type facades for cross-domain imports.
 * Prefer importing from specific domain files: import type { X } from '@schemas/auth.types'
 * Use this barrel only when you need types from multiple domains in one file.
 *
 * Usage:
 *   import type { LoginPayload, AuthData } from '@schemas/auth.types';  // preferred
 *   import type { LoginPayload, Tenant } from '@schemas';               // cross-domain
 */

export type * from './auth.types';
export type * from './security.types';

// Add new domain facades here:
// export type * from './tenant.types';
