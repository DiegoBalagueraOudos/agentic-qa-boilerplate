/**
 * TER terminals: backend input validation at create (TER-003 .. TER-012).
 *
 * Mail-free. Empty storage state: each ATC opens its own crypto session and spends one positive
 * Administrator login; the generated tenant, branch and inactive branch are prepared in `beforeAll`
 * (one more login) and deleted in `afterAll`. trace is off because those logins carry live tokens.
 * Every terminal an ATC creates (including any row the product wrongly accepts) is deleted before it ends.
 */

import { BranchDataSteps } from '@steps/BranchDataSteps';
import { test } from '@TestFixture';

test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

test.describe('TER: terminal input validation', () => {
  const data = new BranchDataSteps();
  let scope = { tenantId: 0, branchId: 0 };
  let inactiveBranchId = 0;

  test.beforeAll(async () => {
    const tenantId = await data.prepareTenant();
    scope = { tenantId, branchId: (await data.prepareBranch(tenantId)).id };
    inactiveBranchId = (await data.prepareInactiveBranch(tenantId)).id;
  });

  test.afterAll(async () => {
    await data.cleanup();
  });

  test('TER-003: should reject a missing, unknown or inactive branch', async ({ api }) => {
    await api.terminals.rejectMissingBranch({ ...scope, inactiveBranchId });
  });

  test('TER-004: should reject invalid terminal names', async ({ api }) => {
    await api.terminals.rejectInvalidTerminalNames(scope);
  });

  test('TER-005: should accept MACs with colons and with hyphens', async ({ api }) => {
    await api.terminals.acceptColonAndHyphenMacs(scope);
  });

  test('TER-006: should reject malformed MACs', async ({ api }) => {
    await api.terminals.rejectMalformedMacs(scope);
  });

  test('TER-007: should reject a duplicate MAC in any format', async ({ api }) => {
    await api.terminals.rejectDuplicateMac(scope);
  });

  test('TER-008: should validate IPv4 and IPv6 addresses', async ({ api }) => {
    await api.terminals.validateIpAddresses(scope);
  });

  test('TER-009: should reject host names with spaces or symbols', async ({ api }) => {
    await api.terminals.rejectInvalidHostNames(scope);
  });

  test('TER-010: should restrict the device type to MOVIL and FIJO', async ({ api }) => {
    await api.terminals.restrictDeviceTypeToMovilAndFijo(scope);
  });

  test('TER-011: should require an IMEI of exactly 15 digits', async ({ api }) => {
    await api.terminals.requireFifteenDigitImei(scope);
  });

  test('TER-012: should require the IMEI for MOVIL', async ({ api }) => {
    await api.terminals.requireImeiForMovil(scope);
  });
});
