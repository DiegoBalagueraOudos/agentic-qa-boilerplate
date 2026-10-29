/**
 * KATA Architecture - Environment Variables Configuration
 *
 * PROJECT-OWNED. `bun sync` never overwrites this file: every project adapts
 * its environments, its URLs, its credential map and its auth endpoints, and
 * that adaptation is the point.
 *
 * The synced half is `config/variables.core.ts`. It holds the `.env` bootstrap,
 * the Atlassian instance-resolver wiring, and the TMS / browser / reporting
 * blocks that synced code reads. Those used to live here, which meant an
 * adapted copy of this file stopped receiving resolver fixes — and the resolver
 * feeds `config.tms.jira.url`, the host the Jira-Direct TMS provider WRITES
 * results back onto. A stale host there does not fail loudly; it writes to the
 * wrong site in silence.
 *
 * WHAT TO EDIT HERE: `Environment`, `envDataMap`, `userCredentialsMap`, and the
 * `auth` block. Everything else is imported and should be changed upstream.
 *
 * Bun automatically loads .env files - no dotenv dependency needed.
 * But the Playwright VSCode extension requires reading process.env as Node.js,
 * so the core calls loadEnvFile() at import time.
 *
 * Usage:
 *   import { config, env } from '@variables';
 */

import {
  BROWSER_CONFIG,
  CORE_ENV,
  REPORTING_CONFIG,
  TMS_CONFIG,
} from './variables.core';

// ============================================
// Environment Type Definitions
// ============================================

export type Environment = 'local';

// ============================================
// Test-User Credentials (variables from .env)
// Which variable holds which environment's credentials is project vocabulary,
// so the read stays here rather than in the synced core.
//
// Nothing validates these up front: not the installer, not the doctor, not the
// env schema, not `test:env:check`. The framework has no opinion on whether
// your app has a login. The one consumer that needs a value is `config.testUser`
// below, which throws a NAMED error the moment something reads it while the
// pair for the active environment is empty. The two auth setups in
// `tests/setup/` read it at t=0, so a missing credential is the first line of
// the run instead of an app-side login failure.
// ============================================

const {
  LOCAL_USER_EMAIL, // Used when TEST_ENV=local
  LOCAL_USER_PASSWORD, // Used when TEST_ENV=local
  LOCAL_TENANT_ADMIN_EMAIL, // Used when TEST_ENV=local
  LOCAL_TENANT_ADMIN_PASSWORD, // Used when TEST_ENV=local
  MAILTRAP_API_TOKEN, // Test mailbox, one for the whole project
  MAILTRAP_SANDBOX_ID, // Test mailbox, one for the whole project
} = process.env;

const userCredentialsMap: Record<Environment, { email: string, password: string }> = {
  local: {
    email: LOCAL_USER_EMAIL ?? '',
    password: LOCAL_USER_PASSWORD ?? '',
  },
};

/**
 * The names `.env` uses for each environment's pair, for the error message
 * only. Keep in step with the destructuring above when you rename them.
 */
const userCredentialVarNames: Record<Environment, { email: string, password: string }> = {
  local: { email: 'LOCAL_USER_EMAIL', password: 'LOCAL_USER_PASSWORD' },
};

// Second principal per environment: the activated TenantAdmin account. Read only
// by `config.tenantAdminUser`; kept out of `envDataMap` so its typing stays as is.
const tenantAdminCredentialsMap: Record<Environment, { email: string, password: string }> = {
  local: {
    email: LOCAL_TENANT_ADMIN_EMAIL ?? '',
    password: LOCAL_TENANT_ADMIN_PASSWORD ?? '',
  },
};

/** Variable names of the TenantAdmin pair, for the error message only. */
const tenantAdminCredentialVarNames: Record<Environment, { email: string, password: string }> = {
  local: { email: 'LOCAL_TENANT_ADMIN_EMAIL', password: 'LOCAL_TENANT_ADMIN_PASSWORD' },
};

// ============================================
// Environment Detection
// ============================================

export const env = {
  ...CORE_ENV,
  current: CORE_ENV.current as Environment,
  isLocal: CORE_ENV.current === 'local',
} as const;

// ============================================
// ENV DATA Mapping (hardcoded - not secrets because these are not sensitive data like credentials)
// ============================================

const envDataMap: Record<
  Environment,
  { base: string, api: string, user: { email: string, password: string } }
> = {
  local: {
    base: 'https://localhost:18443',
    api: 'https://localhost:18443/api',
    user: userCredentialsMap.local,
  },
};
// The point of use for TEST_ENV. A value this file does not declare used to
// crash on `undefined.base` a few lines down; now it says which variable, which
// value, and which names this project accepts.
function resolveEnvData(): (typeof envDataMap)[Environment] {
  const data: (typeof envDataMap)[Environment] | undefined = envDataMap[env.current];
  if (data === undefined) {
    throw new Error(
      `TEST_ENV=${String(env.current)} names an environment this project does not declare. `
      + `Valid values (config/variables.ts envDataMap): ${Object.keys(envDataMap).join(', ')}. `
      + 'Add the environment there (and to the Environment type) or fix TEST_ENV in .env.',
    );
  }
  return data;
}
const envData = resolveEnvData();

/**
 * The active environment's test user, read at the point of use.
 *
 * Throws a NAMED error when either half is empty, so an unset credential fails
 * on the first read (the `ui-setup` / `api-setup` projects, or `bun run
 * api:login`) with the variable names, instead of surfacing later as a login
 * rejected by the app under test. A project whose app has no login never reads
 * this and never sees the error: remove the setup projects from
 * `playwright.config.ts` and `testUser` is simply never touched.
 */
function readTestUser(): { email: string, password: string } {
  const user = envData.user;
  if (user.email !== '' && user.password !== '') { return user; }
  const names = userCredentialVarNames[env.current];
  const missing = [user.email === '' ? names.email : null, user.password === '' ? names.password : null]
    .filter((n): n is string => n !== null);
  throw new Error(
    `Test user for TEST_ENV=${env.current} is not set: ${missing.join(', ')} `
    + '(declared in config/variables.ts, values in .env). '
    + 'No login in your app? Remove the ui-setup / api-setup projects from playwright.config.ts.',
  );
}

/**
 * The active environment's TenantAdmin test account, read at the point of use.
 * Throws a NAMED error (variable names only, never values) when either half is empty.
 */
function readTenantAdminUser(): { email: string, password: string } {
  const user = tenantAdminCredentialsMap[env.current];
  if (user.email !== '' && user.password !== '') { return user; }
  const names = tenantAdminCredentialVarNames[env.current];
  const missing = [user.email === '' ? names.email : null, user.password === '' ? names.password : null]
    .filter((n): n is string => n !== null);
  throw new Error(
    `TenantAdmin user for TEST_ENV=${env.current} is not set: ${missing.join(', ')} `
    + '(declared in config/variables.ts, values in .env).',
  );
}

/**
 * The Mailtrap Email Sandbox that receives the activation e-mails, read at the point of use.
 * One mailbox for the whole project (not per environment). Throws a NAMED error
 * (variable names only, never values) when either variable is empty.
 */
function readMailbox(): { apiToken: string, sandboxId: string } {
  const apiToken = MAILTRAP_API_TOKEN ?? '';
  const sandboxId = MAILTRAP_SANDBOX_ID ?? '';
  if (apiToken !== '' && sandboxId !== '') { return { apiToken, sandboxId }; }
  const missing = [apiToken === '' ? 'MAILTRAP_API_TOKEN' : null, sandboxId === '' ? 'MAILTRAP_SANDBOX_ID' : null]
    .filter((n): n is string => n !== null);
  throw new Error(
    `Test mailbox is not set: ${missing.join(', ')} `
    + '(declared in config/variables.ts, values in .env).',
  );
}

// ============================================
// Main Configuration Object
// ============================================

export const config = {
  // URLs - selected by TEST_ENV from urlMap
  baseUrl: envData.base,
  apiUrl: envData.api,

  // Authentication config (Validate API endpoints - relative to apiUrl). See ADR-0018.
  auth: {
    // Machine-client login (bearer flow of `bun run api:login`). Deferred: not used by the Playwright setups.
    loginEndpoint: '/Auth/login/api',
    // Encrypted human session: handshake first, then the admin login on top of it
    handshakeEndpoint: '/handshake',
    adminLoginEndpoint: '/Auth/login/admin',
    // Storage paths for authenticated sessions (all under the ignored .auth/)
    storageStatePath: '.auth/user.json', // browser: cookies + localStorage from the real SPA login
    // The SPA keeps its UI session metadata (role, name, tenant; no tokens) in sessionStorage
    // under this key (core/auth/token.service.ts). Playwright's storageState does not carry
    // sessionStorage, so ui-setup saves it here and the `page` fixture restores it.
    uiSessionKey: 'auth_session',
    uiSessionPath: '.auth/ui-session.json',
    apiSessionPath: '.auth/api-session.json', // API request context: the three session cookies
    cryptoSessionPath: '.auth/crypto-session.json', // session id + AES key; secret
    apiStatePath: '.auth/api-state.json', // bearer state written by `bun run api:login` only
  },

  // Test User (configure in .env). A getter: validated on first read, by name.
  get testUser(): { email: string, password: string } {
    return readTestUser();
  },

  // TenantAdmin test account (second principal inside the same TEST_ENV). Validated on first read, by name.
  get tenantAdminUser(): { email: string, password: string } {
    return readTenantAdminUser();
  },

  // Test mailbox (Mailtrap Email Sandbox) for the activation e-mails. Validated on first read, by name.
  get mailbox(): { apiToken: string, sandboxId: string } {
    return readMailbox();
  },

  // TMS / Browser / Reporting — synced (config/variables.core.ts)
  tms: TMS_CONFIG,
  browser: BROWSER_CONFIG,
  reporting: REPORTING_CONFIG,
} as const;
