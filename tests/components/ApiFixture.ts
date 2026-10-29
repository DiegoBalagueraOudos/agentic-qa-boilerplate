/**
 * KATA Architecture - Layer 4: API Fixture
 *
 * Dependency Injection container for all API components.
 * Provides unified access to API testing capabilities.
 *
 * All API components share the same request context from TestContext,
 * ensuring consistent authentication and request configuration.
 *
 * HOW TO ADD NEW API COMPONENTS:
 * 1. Create your component in tests/components/api/YourApi.ts
 * 2. Import it here
 * 3. Add as readonly property
 * 4. Initialize in constructor passing the options
 */

import type { TestContextOptions } from '@TestContext';

import type { CryptoSessionState } from '@utils/cryptoSession';

import { AccessApi } from '@api/AccessApi';
import { ApiBase } from '@api/ApiBase';
import { AuthApi } from '@api/AuthApi';
import { DataSecurityApi } from '@api/DataSecurityApi';
import { OperatorsApi } from '@api/OperatorsApi';
import { SessionSecurityApi } from '@api/SessionSecurityApi';
import { TenantAdminsApi } from '@api/TenantAdminsApi';
import { TenantsApi } from '@api/TenantsApi';
import { TransportSecurityApi } from '@api/TransportSecurityApi';
import { UserAppsApi } from '@api/UserAppsApi';
import { UsersApi } from '@api/UsersApi';

// ============================================
// API Fixture Class
// ============================================

export class ApiFixture extends ApiBase {
  /** Auth component - handles login and token management */
  readonly auth: AuthApi;

  /** Tenants component - generated test tenants (ADR-0019) */
  readonly tenants: TenantsApi;

  /** Users component - generated platform Admins (ADR-0019) */
  readonly users: UsersApi;

  /** UserApps component - generated tenant users (ADR-0019) */
  readonly userApps: UserAppsApi;

  /** Access component - token integrity and role access ATCs */
  readonly access: AccessApi;

  /** Operators component - generated operators for the SEC cases (data helper, no ATC) */
  readonly operators: OperatorsApi;

  /** Transport security component - headers, Swagger, CORS (and later CSRF, envelope) ATCs */
  readonly transportSecurity: TransportSecurityApi;

  /** Session security component - cookie flags and secrets on the wire ATCs */
  readonly sessionSecurity: SessionSecurityApi;

  /** Data security component - injection in filters and audit fields ATCs */
  readonly dataSecurity: DataSecurityApi;

  /** TenantAdmins component - generated TenantAdmins and the ADM cases (mail-sending creates are budgeted by their specs) */
  readonly tenantAdmins: TenantAdminsApi;

  constructor(options: TestContextOptions) {
    super(options);

    // All components receive the same options (same request context)
    this.auth = new AuthApi(options);
    this.access = new AccessApi(options);
    this.tenants = new TenantsApi(options);
    this.users = new UsersApi(options);
    this.userApps = new UserAppsApi(options);
    this.operators = new OperatorsApi(options);
    this.transportSecurity = new TransportSecurityApi(options);
    this.sessionSecurity = new SessionSecurityApi(options);
    this.dataSecurity = new DataSecurityApi(options);
    this.tenantAdmins = new TenantAdminsApi(options);
  }

  // ============================================
  // Session Propagation to Child Components
  // ============================================

  /**
   * Set the encrypted-session state (ADR-0018) for every secure component.
   * Add each new SecureApi component here, like `auth`.
   */
  setCryptoSession(state: CryptoSessionState) {
    this.auth.setCryptoSession(state);
    this.access.setCryptoSession(state);
    this.tenants.setCryptoSession(state);
    this.users.setCryptoSession(state);
    this.userApps.setCryptoSession(state);
    this.operators.setCryptoSession(state);
    this.transportSecurity.setCryptoSession(state);
    this.sessionSecurity.setCryptoSession(state);
    this.dataSecurity.setCryptoSession(state);
    this.tenantAdmins.setCryptoSession(state);
  }

  clearCryptoSession() {
    this.auth.clearCryptoSession();
    this.access.clearCryptoSession();
    this.tenants.clearCryptoSession();
    this.users.clearCryptoSession();
    this.userApps.clearCryptoSession();
    this.operators.clearCryptoSession();
    this.transportSecurity.clearCryptoSession();
    this.sessionSecurity.clearCryptoSession();
    this.dataSecurity.clearCryptoSession();
    this.tenantAdmins.clearCryptoSession();
  }

  /**
   * Set authentication token for all API components.
   * This ensures all components use the same token for authenticated requests.
   */
  override setAuthToken(token: string) {
    super.setAuthToken(token);
    this.auth.setAuthToken(token);
    this.access.setAuthToken(token);
    this.tenants.setAuthToken(token);
    this.users.setAuthToken(token);
    this.userApps.setAuthToken(token);
    this.operators.setAuthToken(token);
    this.transportSecurity.setAuthToken(token);
    this.sessionSecurity.setAuthToken(token);
    this.dataSecurity.setAuthToken(token);
    this.tenantAdmins.setAuthToken(token);
  }

  /**
   * Clear authentication token from all API components.
   */
  override clearAuthToken() {
    super.clearAuthToken();
    this.auth.clearAuthToken();
    this.access.clearAuthToken();
    this.tenants.clearAuthToken();
    this.users.clearAuthToken();
    this.userApps.clearAuthToken();
    this.operators.clearAuthToken();
    this.transportSecurity.clearAuthToken();
    this.sessionSecurity.clearAuthToken();
    this.dataSecurity.clearAuthToken();
    this.tenantAdmins.clearAuthToken();
  }
}
