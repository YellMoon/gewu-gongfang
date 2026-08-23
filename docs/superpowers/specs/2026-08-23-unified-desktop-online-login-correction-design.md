# Unified desktop online login correction

## Goal

Any computer running the single desktop package uses the cloud account as the identity authority. A new device must verify online, then cloud silently records the device and installation. A registered device may use a separate local unlock password for encrypted drafts. Offline use is restricted to a still-valid cloud-signed lease and never submits drafts automatically.

## Confirmed gap

`DesktopIdentityGate` already contains the cloud silent-registration client and cloud password-verification client, but its locked screen still routes password recovery through the retired device-approval flow. The UI has no account-name or phone plus cloud-password entry point. This exposes the old host-authority model.

## Chosen approach

Reuse the existing short-lived cloud verification, registration, and local vault interfaces. Add the account-password entry point and make recovery use cloud re-verification followed by silent registration. Do not attempt the separate account multi-binding migration in this UI correction; that is a later data-model batch.

## Verification

Tests must prove: account-password verification silently registers, WeChat verification silently registers, recovery does not use old approval endpoints, and offline access remains lease-scoped.
