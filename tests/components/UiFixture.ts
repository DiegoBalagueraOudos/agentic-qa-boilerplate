/**
 * KATA Architecture - Layer 4: UI Fixture
 *
 * Dependency Injection container for all UI components.
 * Provides unified access to UI testing capabilities.
 *
 * All UI components share the same page context from TestContext,
 * ensuring consistent browser state across components.
 *
 * HOW TO ADD NEW UI COMPONENTS:
 * 1. Create your component in tests/components/ui/YourPage.ts
 * 2. Import it here
 * 3. Add as readonly property
 * 4. Initialize in constructor passing the options
 */

import type { TestContextOptions } from '@TestContext';

import { ActivationPage } from '@ui/ActivationPage';
import { BulkImportPage } from '@ui/BulkImportPage';
import { CompatPage } from '@ui/CompatPage';
import { ContractsPage } from '@ui/ContractsPage';
import { DashboardPage } from '@ui/DashboardPage';
import { LocalePage } from '@ui/LocalePage';
import { LoginPage } from '@ui/LoginPage';
import { LogsPage } from '@ui/LogsPage';
import { OperatorsPage } from '@ui/OperatorsPage';
import { SessionPage } from '@ui/SessionPage';
import { ShellPage } from '@ui/ShellPage';
import { SmokePage } from '@ui/SmokePage';
import { TenantAdminsPage } from '@ui/TenantAdminsPage';
import { TenantDetailPage } from '@ui/TenantDetailPage';
import { TenantsPage } from '@ui/TenantsPage';
import { UiBase } from '@ui/UiBase';

// ============================================
// UI Fixture Class
// ============================================

export class UiFixture extends UiBase {
  /** Login page component - handles authentication flows */
  readonly login: LoginPage;

  /** Activation page component - account activation and resend flows */
  readonly activation: ActivationPage;

  /** Shell page component - signed-in shell: logout, reload and the role matrix (routes, menu, root redirect) */
  readonly shell: ShellPage;

  /** Session page component - token refresh and inactivity behaviours */
  readonly session: SessionPage;

  /** Operators page component - hostile names rendering (SEC-003), list and search (OPE-001), counter after create (OPE-012) */
  readonly operators: OperatorsPage;

  /** Tenant admins page component - load time of the Administradores tab (ADM-013) */
  readonly tenantAdmins: TenantAdminsPage;

  /** Tenants page component - tenant list and creation form (OPE-013) */
  readonly tenants: TenantsPage;

  /** Tenant detail page - resources tabs and CSV exports (UAP, TEN cases) */
  readonly tenantDetail: TenantDetailPage;

  /** Logs page - Administrator log review screen (LOG cases) */
  readonly logs: LogsPage;

  /** Dashboard page - Administrator statistic cards (DSH cases) */
  readonly dashboard: DashboardPage;

  /** Contracts page - what the screens do with the backend answers (INT cases) */
  readonly contracts: ContractsPage;

  /** Smoke page - short "the application is alive" paths of the three roles (SMK cases) */
  readonly smoke: SmokePage;

  /** Bulk import page - the CSV import modal of a tenant (NF-02) */
  readonly bulkImport: BulkImportPage;

  /** Compatibility page - the same walk in several browsers (NF-04) */
  readonly compat: CompatPage;

  /** Locale page - accents and dates (NF-08) */
  readonly locale: LocalePage;

  constructor(options: TestContextOptions) {
    super(options);

    // All components receive the same options (same page context)
    this.login = new LoginPage(options);
    this.activation = new ActivationPage(options);
    this.shell = new ShellPage(options);
    this.session = new SessionPage(options);
    this.operators = new OperatorsPage(options);
    this.tenantAdmins = new TenantAdminsPage(options);
    this.tenants = new TenantsPage(options);
    this.tenantDetail = new TenantDetailPage(options);
    this.logs = new LogsPage(options);
    this.dashboard = new DashboardPage(options);
    this.contracts = new ContractsPage(options);
    this.smoke = new SmokePage(options);
    this.bulkImport = new BulkImportPage(options);
    this.compat = new CompatPage(options);
    this.locale = new LocalePage(options);
  }
}
