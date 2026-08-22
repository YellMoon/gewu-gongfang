# Encrypted NAS Media Relay Design

**Status:** approved by the product owner on 2026-08-23 for an encrypted, short-lived cloud relay.

## Boundary

Cloud remains the unique write authority for business data and question-bank structured text. NAS is the immutable holder of question-bank rich-media bytes, import originals, generated Word/PDF products, checksums and backups. The relay is neither an authority nor a media archive: it holds only ciphertext for a bounded transfer window.

There is no existing source question or asset data to migrate. This design therefore implements the transfer path and its refusal rules, without fabricating a historical media migration.

## Data flow

1. A desktop source creates a random 32-byte AES-256-GCM content key and encrypts the file locally. It calculates plaintext SHA-256 and byte count before encryption.
2. The source seals that content key to the configured NAS agent X25519 public key. The cloud receives ciphertext, nonce, authentication tag, sealed key, ciphertext SHA-256, plaintext hash/size, MIME type and a short expiry. It never receives a decryptable content key.
3. Cloud stores encrypted relay chunks and opaque metadata under a relay id, associates them with exactly one storage task, and leases that task only to the configured agent.
4. The NAS agent downloads the leased ciphertext using its lease token, verifies ciphertext SHA-256, opens the sealed key with its local private key, decrypts, then uses the existing immutable `putVerified` read-back path for the plaintext descriptor.
5. Only after that read-back succeeds does the agent submit the existing verified receipt. The cloud transaction marks the task verified and deletes all relay chunks in the same completion path. Expired, abandoned, failed or quarantined relays are deleted by the cleanup path.

## Security rules

- Relay bytes are accepted only for an authenticated cloud business session with a role allowed to create question-bank media. The endpoint is not a generic file store and it cannot accept plaintext.
- The cloud validates exact request shapes, ids, byte bounds, media type and all base64url fields. It stores no NAS private key, source content key, filesystem path, URL or user supplied storage path.
- The agent token and lease token remain header/body credentials for the existing agent contract; neither is recorded in task rows or relay metadata.
- A relay is one-shot: it is bound to task id/object id/version, its lease, and a maximum expiry. A receipt can be issued only after NAS plaintext hash/length verification.
- Normal task state, receipt and cleanup records remain cloud business/audit metadata; no cloud operation can treat relay presence as proof that NAS contains a file.

## Delivery scope

This implementation is intentionally split into two independently testable parts:

1. Cloud relay metadata/chunk lifecycle and leased agent download, with strict expiry and deletion semantics.
2. Desktop source encryption/upload and NAS decryption worker integration, only after the cloud lifecycle is proven.

The first part must not expose an upload route until it can be linked to a cloud-owned question-asset metadata command. The old local `question_assets` database is not a cloud authority and must not be used as that link.

## Verification

- Unit tests prove plaintext and raw keys cannot enter the relay contract; altered ciphertext, expired lease and stale task all fail.
- An integration test proves the agent stores only after decrypt + plaintext read-back hash verification, then the relay records are deleted before a verified receipt is returned.
- Deployment checks prove relay storage has a hard TTL cleanup job and that there is no anonymous or long-lived media URL.
