# Offline aggregate confirmation lifecycle

UTF-8. This implements the user's approved requirement: one aggregate decision
before offline drafts are sent. Continue in this checkout without subagents.

Goal: prevent the actual React effect from opening another dialog every four
seconds, prevent submission re-entry, and invalidate a dialog when its account
leaves. Keep the current cloud REST, encrypted outbox and conflict pause policy.

Implementation: hold the Modal instance in a ref, guard polling and submission,
destroy it on effect cleanup, and reject callbacks from a stopped effect.

- [x] Actual-component regression: two timer ticks produced three dialogs,
  expected one. No submissions occurred before the decision.
- [x] Update DesktopAutoSync.tsx to own the dialog through its lifecycle.
- [x] Verify one decision submits two drafts, postponement stays local, new
  batches can prompt, unmount disables old callbacks, and in-flight work cannot
  re-enter. Exercise dependencies and conflict boundaries before further changes.
- [x] Include the test in test:business-parity; run relevant and full regression
  gates and typecheck.
- [ ] Prepare a desktop patch with other compatible component versions unchanged;
  commit/push gewu/master, dist:win, OSS feed/artifact verification and Node ABI.

Existing evidence: packaged desktop 8.9.20 teacher registration, native device
name, live device refresh and cold-process recovery passed. Only the newly
generated device/session/link was revoked. This is a verified-account fixture,
not a password or WeChat phone-consent test, and does not prove offline batching.
