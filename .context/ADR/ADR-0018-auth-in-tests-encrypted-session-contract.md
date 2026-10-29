# ADR-0018 — Auth in tests: honour the encrypted-session contract of the Validate API (discovered)

- **Status:** Accepted (2026-10-23)
- **Date:** 2026-10-22
- **Deciders:** the user running `/project-discovery`, who accepted it and resolved the open question at the Phase 2 checkpoint on 2026-10-23. It was discovered by reading the code in Phase 2, not decided in the session that wrote it.
- **Tags:** auth-in-tests, api-tests, fixtures, security, discovered
- **Supersedes:** —
- **Superseded by:** —

---

## Context

Discovered, not decided here. The system under test (branch `sbx` of the two repositories under `../PruebasMultitenantValidate/`) enforces an authentication and transport contract that every automated test has to cross. Where it was found (details in the `architecture` and `nfr-security` sections of the infra map, `infra-context`):

- Before any call to a protected route prefix, the client opens a crypto session with `POST /api/handshake` (ECDH P-256, then HKDF-SHA256 to an AES-256-GCM key). The backend keeps the session key in process memory (`MultitenantValidate.Infrastructure/Infrastructure/Services/EcdhSessionService.cs`).
- Twelve route prefixes carry `{ct, nonce}` envelopes with `X-Session-Id` and `X-Timestamp` headers; a nonce can be used once and a timestamp is accepted within 60 seconds (`MultitenantValidate.API/Middleware/PayloadDecryptionMiddleware.cs`). The SPA does the same through `src/app/core/interceptors/encryption.interceptor.ts` and `src/app/core/crypto/crypto-session.service.ts`.
- The session itself is a JWT in HttpOnly cookies plus a double-submit CSRF token (`X-CSRF-Token` header equal to the `csrf_token` cookie) on every mutating call (`MultitenantValidate.API/Middleware/CsrfValidationMiddleware.cs`).
- Login is limited to 4 failed attempts per 30 seconds per address, and users carry a lockout (`FailedLoginLimiterService.cs`, `AuthService.cs`).
- Outside Production the backend accepts a plaintext body when no session id is sent and skips CSRF when the header is absent in Development. In Production neither fallback exists and tokens are emptied from the login body (`PayloadDecryptionMiddleware.cs`, `CsrfValidationMiddleware.cs`, `AuthCookieService.cs`).
- Machine access (`POST /api/auth/login/api`, tenant API credentials) is excluded from the envelope and returns a bearer token.

The repositories ship no automated tests; the only API assets are an untracked Postman collection with helper scripts for the handshake (`ms_validate_tenant_backend/tests/postman/`).

## Decision

Automated tests authenticate the way a real client does and never depend on the non-production fallbacks.

- UI (E2E) tests log in through the SPA, which performs the handshake, cookies and CSRF itself.
- API tests run through one shared fixture that performs the handshake, encrypts and decrypts the envelopes, and carries the cookie and CSRF token. Tests do not send plaintext bodies to the prefixes that require encryption, even where a non-production environment would accept them.
- Machine-credential routes (`/api/auth/login/api`, `/api/Synchronize/*`) are tested with the bearer-token flow.
- Test accounts are created with the admin flow or the seed, never by weakening lockout or rate-limit settings.

Resolved at acceptance (2026-10-23): the fixture lives in TypeScript inside this boilerplate and re-implements the HKDF salt and info strings, which are literals in both repositories. A test-only switch in a non-production backend was rejected.

## Consequences

- **Positive:** tests exercise the same path as production, so a change to the handshake, nonce or CSRF rules breaks a test instead of a customer; the suite works against Production-like configuration.
- **Negative / trade-offs:** a crypto helper has to be written and kept in step with two literals (HKDF salt and info) copied between the backend and the SPA; each API request costs an encryption round trip; the OpenAPI types describe plaintext DTOs while the wire carries envelopes, so generated types need a thin wrapper; the 4-attempts-in-30-seconds login limit forces login reuse (stored session per role) rather than one login per test.
- **Neutral / follow-ups:** the ECDH sessions live in memory and expire after 30 idle minutes (8 hours at most), so long suites must renew them; a multi-replica deployment would need sticky sessions or a shared session store, which is a product question outside this ADR; the address-based limits behind nginx depend on forwarded-header handling that was not found in the code (see `discovery-gaps`).

## Alternatives considered

- **Rely on the non-production plaintext and CSRF fallbacks.** Cheaper to start, but it tests a different path from Production and the fallbacks may be removed without notice.
- **Disable encryption, rate limits and lockout through configuration in a test environment.** Removes the main source of friction, but the suite would then not detect regressions in the controls that matter most for this product.
- **Test only through the UI.** Avoids the crypto helper, but loses fast API-level coverage of the 105 documented operations.

## References

- Infra map sections `architecture`, `nfr-security`, `discovery-gaps` (skill `infra-context`)
- `../PruebasMultitenantValidate/ms_validate_tenant_backend/docs/Seguridad.md`
- `../PruebasMultitenantValidate/ms_validate_tenant_backend/tests/postman/` (helper scripts for the handshake, untracked)
