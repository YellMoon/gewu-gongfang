# Multi-contact student identity design

## Decision

One student profile may be reached by at most three separate canonical accounts: one student account and two guardian accounts. Each account has independent credentials, devices, sessions, receipts, audits, and offline leases. They share only the opaque student data scope.

The existing `business.miniapp_cloud_role_grants` relation is the sole student-access relation. It already binds canonical account IDs to student profiles. The additive student-access migration adds a relationship discriminator and database-enforced maximum; it does not create a parallel `vnext_profile_bindings` model.

## Identity rules

- Every account must record a verified phone before it becomes active.
- The only contact identities that can authenticate or resolve an account are verified `phone`, official WeChat `wechat_openid`, and official WeChat `wechat_unionid`.
- A manually typed WeChat ID is a restricted contact or invitation hint. It can never authenticate, create, resolve, or bind an account.
- Contact identities are authority-wide unique and cannot silently move to another canonical account.
- Desktop login name and password are optional per canonical account. A successful password check only returns a short-lived online registration ticket; the normal device-proof registration flow still creates the device/session/lease.

## Student access rules

- A student profile has at most one active relationship of type `student` and at most two active relationships of type `guardian`.
- A canonical account has at most one active role/profile grant, as enforced by the existing business role table.
- A revoked guardian no longer counts toward the cap and has no student scope. It does not affect the student account or another guardian account.
- A teacher may create a pending invitation/contact hint for a student. A separate actor-authorization slice must define which teacher may activate which student; no caller can self-select another account, student, role, or relationship.

## Delivery boundary

The controlled M17-to-M18 control-plane upgrade is required before exposing desktop password routes. The additive business student-access SQL is applied after its backup and schema checks. Official WeChat identity binding needs its own cloud implementation: it must verify a WeChat login code server-side, bind the returned official identity to the already phone-verified canonical account, and reject conflicts atomically.

No raw phone number, OpenID, UnionID, password, token, key, or manually entered WeChat ID may appear in API responses, general logs, receipts, audit payloads, outbox payloads, or desktop vault state.

## Acceptance

- Student, guardian 1, and guardian 2 use independent verified accounts and each gets only the same student scope.
- A fourth active relationship, second self relationship, cross-student/cross-authority assignment, unverified contact, or manual WeChat ID fails without a partial write.
- Repeated login resolves the same canonical account and never creates a duplicate account or binding.
- New desktop devices require online account verification and device proof. Offline operation is limited to an unexpired cloud-signed local lease creating an awaiting-confirmation draft.
- Cloud, desktop, and miniapp responses never expose secret or raw identity material.
