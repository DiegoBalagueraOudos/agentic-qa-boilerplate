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
import { BranchesApi } from '@api/BranchesApi';
import { ConcurrencyApi } from '@api/ConcurrencyApi';
import { DataIntegrityApi } from '@api/DataIntegrityApi';
import { DataSecurityApi } from '@api/DataSecurityApi';
import { DevicesApi } from '@api/DevicesApi';
import { LogsApi } from '@api/LogsApi';
import { OperatorsApi } from '@api/OperatorsApi';
import { PlatformConfigApi } from '@api/PlatformConfigApi';
import { ProductsApi } from '@api/ProductsApi';
import { RolesApi } from '@api/RolesApi';
import { SessionSecurityApi } from '@api/SessionSecurityApi';
import { TenantAdminsApi } from '@api/TenantAdminsApi';
import { TenantManagementApi } from '@api/TenantManagementApi';
import { TenantsApi } from '@api/TenantsApi';
import { TerminalsApi } from '@api/TerminalsApi';
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

  /** Branches component - the SUC cases (branch catalog, validation, CSV import) */
  readonly branches: BranchesApi;

  /** Products component - the PRO cases (catalog, code and name validation, status, TenantAdmin access) */
  readonly products: ProductsApi;

  /** Platform configuration component - the CFG cases (contingency switch, global lockout threshold) */
  readonly platformConfig: PlatformConfigApi;

  /** Data integrity component - the DAT cases (soft delete, operator references, credential history, seeded data) */
  readonly dataIntegrity: DataIntegrityApi;

  /** Concurrency component - the CON cases (simultaneous creates of the same record) */
  readonly concurrency: ConcurrencyApi;

  /** Tenant management component - the TEN cases (create, edit, logo, status, delete) */
  readonly tenantManagement: TenantManagementApi;

  /** Logs component - log review views and their filters (LOG cases) */
  readonly logs: LogsApi;

  /** Terminals component - minimal data helper for the SUC cases (no ATC) */
  readonly terminals: TerminalsApi;

  /** Devices component - minimal data helper for the TER cases (no ATC) */
  readonly devices: DevicesApi;

  /** Roles component - the USR-012 ATC (platform roles) */
  readonly roles: RolesApi;

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
    this.branches = new BranchesApi(options);
    this.products = new ProductsApi(options);
    this.platformConfig = new PlatformConfigApi(options);
    this.dataIntegrity = new DataIntegrityApi(options);
    this.concurrency = new ConcurrencyApi(options);
    this.tenantManagement = new TenantManagementApi(options);
    this.logs = new LogsApi(options);
    this.terminals = new TerminalsApi(options);
    this.devices = new DevicesApi(options);
    this.roles = new RolesApi(options);
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
    this.branches.setCryptoSession(state);
    this.products.setCryptoSession(state);
    this.platformConfig.setCryptoSession(state);
    this.dataIntegrity.setCryptoSession(state);
    this.concurrency.setCryptoSession(state);
    this.tenantManagement.setCryptoSession(state);
    this.logs.setCryptoSession(state);
    this.terminals.setCryptoSession(state);
    this.devices.setCryptoSession(state);
    this.roles.setCryptoSession(state);
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
    this.branches.clearCryptoSession();
    this.products.clearCryptoSession();
    this.platformConfig.clearCryptoSession();
    this.dataIntegrity.clearCryptoSession();
    this.concurrency.clearCryptoSession();
    this.tenantManagement.clearCryptoSession();
    this.logs.clearCryptoSession();
    this.terminals.clearCryptoSession();
    this.devices.clearCryptoSession();
    this.roles.clearCryptoSession();
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
    this.branches.setAuthToken(token);
    this.products.setAuthToken(token);
    this.platformConfig.setAuthToken(token);
    this.dataIntegrity.setAuthToken(token);
    this.concurrency.setAuthToken(token);
    this.tenantManagement.setAuthToken(token);
    this.logs.setAuthToken(token);
    this.terminals.setAuthToken(token);
    this.devices.setAuthToken(token);
    this.roles.setAuthToken(token);
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
    this.branches.clearAuthToken();
    this.products.clearAuthToken();
    this.platformConfig.clearAuthToken();
    this.dataIntegrity.clearAuthToken();
    this.concurrency.clearAuthToken();
    this.tenantManagement.clearAuthToken();
    this.logs.clearAuthToken();
    this.terminals.clearAuthToken();
    this.devices.clearAuthToken();
    this.roles.clearAuthToken();
  }
}
