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

## Required platform action and boundary

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
