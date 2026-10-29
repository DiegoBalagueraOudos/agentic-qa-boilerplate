/**
 * Crypto session helper (ADR-0018)
 *
 * The Validate API wraps the bodies of twelve route prefixes in an AES-256-GCM
 * envelope `{ ct, nonce }` keyed by an ECDH P-256 handshake. This file is the
 * pure half of that contract: key agreement and envelope encode/decode. It
 * holds no HTTP and no Playwright state; `SecureApi` performs the handshake
 * call and carries the session.
 *
 * Contract sources (read from code, not from the Postman helpers):
 * - Backend: EcdhSessionService.cs (salt/info), PayloadDecryptionMiddleware.cs
 * - SPA:     core/crypto/crypto-session.service.ts
 *
 * HKDF_SALT and HKDF_INFO are literals duplicated in both products. If a
 * handshake starts failing with "Payload inválido", compare them first.
 * (The salt in ms_validate_tenant_backend/tests/postman/hu23-ecdh-happy-path.js
 * is stale: `securid-middleware-salt-v1`.)
 */

import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const HKDF_SALT = Buffer.from('securid-validate-salt-v1', 'utf8');
const HKDF_INFO = Buffer.from('aes-session-key', 'utf8');
const GCM_TAG_BYTES = 16;
const GCM_NONCE_BYTES = 12;

export interface EncryptedEnvelope {
  ct: string
  nonce: string
}

/** What a later process needs to keep talking on an established session. */
export interface CryptoSessionState {
  sessionId: string
  /** AES-256 key, base64. Secret: lives only in ignored `.auth/`. */
  aesKey: string
}

export interface PendingHandshake {
  /** Client public key, SPKI DER, base64: the `ClientPublicKey` of POST /api/handshake. */
  clientPublicKey: string
  /** Completes the agreement from the server's SPKI public key (base64). Returns the AES key. */
  deriveAesKey: (serverPublicKeyB64: string) => Buffer
}

export function startHandshake(): PendingHandshake {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  return {
    clientPublicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    deriveAesKey: (serverPublicKeyB64) => {
      const serverPublicKey = createPublicKey({
        key: Buffer.from(serverPublicKeyB64, 'base64'),
        format: 'der',
        type: 'spki',
      });
      const sharedSecret = diffieHellman({ privateKey, publicKey: serverPublicKey });
      return Buffer.from(hkdfSync('sha256', sharedSecret, HKDF_SALT, HKDF_INFO, 32));
    },
  };
}

/** `ct` is ciphertext followed by the 16-byte GCM tag, exactly as the middleware splits it. */
export function encryptEnvelope(aesKey: Buffer, data: object): EncryptedEnvelope {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', aesKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);

  return {
    ct: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
    nonce: nonce.toString('base64'),
  };
}

export function isEnvelope(body: unknown): body is EncryptedEnvelope {
  return typeof body === 'object' && body !== null && 'ct' in body && 'nonce' in body;
}

/** Throws on a bad key or tampered envelope: GCM authentication fails loudly. */
export function decryptEnvelope<T = unknown>(aesKey: Buffer, envelope: EncryptedEnvelope): T {
  const combined = Buffer.from(envelope.ct, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.nonce, 'base64'));
  decipher.setAuthTag(combined.subarray(combined.length - GCM_TAG_BYTES));
  const plaintext = Buffer.concat([
    decipher.update(combined.subarray(0, combined.length - GCM_TAG_BYTES)),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString('utf8')) as T;
}
