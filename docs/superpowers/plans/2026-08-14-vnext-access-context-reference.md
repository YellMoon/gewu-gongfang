# vNext Read-Only AccessContext Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task with test-first verification.

**Goal:** Resolve one current, server-verified online session into a frozen AccessContext without accepting caller identity or writing control-plane state.

**Architecture:** The resolver receives an injected current V4 SQLite handle, one verifier boundary and a deployment-fixed surface. `resolve(assertion)` unwraps the opaque assertion, reads current V3/V4 rows, re-canonicalizes the highest policy publication, then delegates policy mathematics to the existing pure contract. Every invalid state maps to one fail-closed error.

**Tech Stack:** Node.js CommonJS, better-sqlite3 read-only statements, existing V3/V4 and policy reference modules.

## Tasks

- [x] Write focused `:memory:` red tests for one valid desktop context, visitor derivation, deny/surface/scope behavior, opaque assertion rejection, session/parent/vector/time failure, policy missing/canonical/hash failure, reauth selection and read-only counts/FK state.
- [x] Implement `shared/vNextAccessContextResolverReference.js` with only `{ db, verifierBoundary, surface, now }` and `resolve(assertion)`; assert exact V4 schema without bootstrap; use no caller facts besides opaque assertion.
- [x] Read the highest authority-local publication; require contract 1, canonical JSON byte equality and SHA-256 equality through `vNextAuthorizationPolicyReference`; never fall back to default policy.
- [x] Load active-state/session-vector rows plus account role/override/scope records; return a deeply frozen plain context with no reauth factor/evidence; no profile binding output.
- [x] Record only reference-boundary evidence, run focused/full/diff, obtain GPT-5.6-sol necessity+quality PASS, commit task-only files, push `gewu/master`.

## Exclusions

No token issuance/verification, credential/session mutation, API/runtime/gateway, real DB/path/network, business migration, caching, audit/outbox write, profile binding, offline license or route integration.

The V4 publication's canonical manifest is the sole policy truth while resolving. `vNext_capability_catalog` is only the override foreign-key vocabulary and a future publication-writer validation source; it cannot silently alter a published policy at read time.
