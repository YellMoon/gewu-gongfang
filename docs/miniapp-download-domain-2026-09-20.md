# Miniapp download-domain acceptance failure

Date: 2026-09-20. Cloud 8.11.19, miniapp 8.8.7, NAS 8.8.3.
This check changes test tooling only, not app behavior, permissions or deployment.

## Reproduction and evidence

In the dist project window, domain validation is enabled. Two real visitor
question-bank observations retained an image23.png placeholder:

- `gewu-miniapp-media-diagnostic-20260920-_p_2dy40/visitor-media-observed.png`,
  SHA256 `09af89d76e0abac45c0f71dfdd8880ef77c7abd494e53459572e135751502939`.
- `gewu-miniapp-media-diagnostic-20260920-nu_kf6gl/visitor-media-observed.png`.

Both images were individually viewed. The sessions were cloud-signed isolated
visitor sessions and the previous simulator login was restored. No question or
teaching record changed. The normal UI created temporary media deliveries.

Parsed developer-tool HTTP events tie the first displayed question's media key
to `question_asset_delivery_58dfd00d-7b07-4521-8066-49274ef86e64`.
Its second preparation response was already ready, HTTP 200 in 52 ms. This is
not an unfinished NAS task or a reason to create a replacement task.

Read-only public REST status/download checks on the exact observed tasks:

| Delivery suffix | Status | PNG dimensions | Bytes | SHA256 |
| --- | --- | --- | --- | --- |
| 58dfd00d | ready / HTTP 200 | 2680 x 2060 | 255857 | cf1b911981e814d36e9700fb054efc1756e8dbb1bff0e27c69947f87541e9c1d |
| acb0cf9d | ready / HTTP 200 | 3217 x 1686 | 73796 | 5faa9ad8026cdce95c328f7ecd80355d9a2d18a50ffe692abb0814925b4cf062 |

The same authenticated first-image URL passed to the real wx.downloadFile API
failed with `createDownloadTask:fail url not in domain list`. The direct REST
success does not establish that WeChat download permissions work.

The root miniapp project's private configuration currently has urlCheck=false;
the dist project has urlCheck=true and no private override. Neither was changed.
Historical transfer evidence from the original project is therefore insufficient
to prove downloads with production domain validation enabled. This does not
invalidate its artifact hashes or the independently checked course/ledger UI.

## Sep 23 follow-up

The user has confirmed the downloadFile domain addition and that the intended
miniapp is Gewu Zhilin (wx3d570539bbe6ba1b). Do not request that confirmation
again. The Sep 23 strict dist probe still fails with
`REAL_MINIAPP_DOWNLOAD_DOMAIN_NOT_ALLOWED:downloadFile:https://physicsedu.xyz`.
Effective urlCheck remains true. The remaining platform/configuration cause
has not been established; working public HTTP is not download acceptance.
Continue independent page audits without disabling this gate or replacing NAS.
The following Sep 20 platform-action section is historical, not a new request.

## Sep 20 required platform action and boundary

Add `https://physicsedu.xyz` to this miniapp's downloadFile server-domain list,
preserving all existing domains. Request-domain access already works but is not
the same platform permission. Do not disable validation, move downloads to an
unverified alternate origin or update the NAS container for this configuration.

Opening the WeChat platform was rejected by the browser's site-safety policy.
No alternative browser, raw protocol or indirect platform-write workaround was
attempted. The user was asked to apply the domain entry; no confirmation has yet
been received. Afterward refresh platform configuration as needed and rerun the
strict domain probe, actual image rendering and actual Word/PDF button downloads.

## New regression gate

`scripts/run_real_miniapp_role_ui.py` now gates --pages runs with a real,
unauthenticated wx.downloadFile request to the public cloud health endpoint,
before reading/changing user login or issuing any test sessions. --download-domain-only
runs just this check. It records only origin/status and never records temporary
download paths or credentials. This probe proves domain access, not media bytes,
document opening or all-page acceptance.

The gate refuses an effective local urlCheck=false (including private overrides),
missing/invalid configuration, rejected download, non-200 response or missing
temporary path. It does not fall back to wx.request or retry a rejected domain.

Tests first failed with the missing gate; after implementation:

- miniapp-download-domain.test.py: 7 tests passed.
- run_real_miniapp_role_ui.test.py: 38 tests passed (includes the seven new
  download tests, so the existing release-matrix command cannot skip them).
- real-miniapp-startup-wait.test.py: 3 tests passed.

Current live checks correctly fail: dist reports DOWNLOAD_DOMAIN_NOT_ALLOWED;
the root project reports DOWNLOAD_DOMAIN_CHECK_DISABLED without attempting a
download. No release/version change is needed for this test-tool correction.
The full goal remains active and release remains partial.

## Sep 24: refreshed metadata and callback-based strict probe

Actual Windows DevTools project information confirmed Gewu Zhilin,
AppID `wx3d570539bbe6ba1b`. Project Configuration initially showed request
domain `https://physicsedu.xyz`, but uploadFile/downloadFile were unset.
Clicking the domain-list refresh control (read-only metadata sync) immediately
showed that origin under both uploadFile and downloadFile. No allowlist,
security setting, account, project configuration or NAS container was changed.

The existing simulator still rejected the origin after that refresh and normal
compilation. Closing/reopening the dist project replaced the old runtime.
The first reopen returned `terminated` after the last window closed; window
inventory and runtime lookup confirmed no project, then the official open call
succeeded. No write operation was blindly repeated.

The generic `automation_wx_api downloadFile` bridge then timed out with
`An object could not be cloned` in the DevTools appservice log. A controlled
`automation_evaluate` calling the same real `wx.downloadFile` and awaiting its
completion callback returned HTTP 200 with a nonempty temporary file. The
native DownloadTask returned synchronously by downloadFile is not a completed
download result and cannot be cloned through that bridge.

The regression probe now awaits callbacks and returns only status/temporary-file
presence. It still requires effective urlCheck=true, rejects missing files,
non-200 responses and domain failures, and never substitutes wx.request.
Tests execute the exact callback expression against an asynchronous API double
returning an uncloneable task object; no private temporary path reaches the
receipt. Tests failed before correction, then passed: domain 8, aggregate
role-runtime 39 (includes domain tests), startup-wait 3.

The corrected real strict dist probe passed with statusCode=200 and
domainCheckEnabled=true on Sep 24. This resolves the origin-access gate only.
Actual role-scoped question images and paper-button downloads are being checked
separately; neither all-page acceptance nor physical-device downloads follow
from this health-endpoint probe.

Actual question-media follow-up on miniapp 8.8.22 / live cloud 8.11.21:
`gewu-media-runtime-20260924-ilfjsoom` (teacher) and
`gewu-media-runtime-20260924-t0asn6bi` (super admin, student, family, visitor)
both exited 0 with ok=true and exact authRestored/storageRestored=true.
All five roles loaded the first real cloud question's diagram with no placeholder;
native getImageInfo confirmed 2680x2060. Answers were initially collapsed and
actual expand/collapse passed. All ten question/answer screenshots were inspected.
These are first-question media samples, not every image/filter/late-page geometry.
No teaching/question records were modified and no response was mocked.
