# Course list layout and role checks — Sep 24, 2026

## Bounded correction

The actual administrator and teacher pages had 31.6px-high filter targets.
The non-tab course route also reserved a phantom tab-bar area below a separately
sized nested viewport. Enlarge filters to a 44px minimum, include padding in the
minimum width, and let the existing list use the remaining flex height, reserving
only the device safe area. The existing ScrollView refresher remains unchanged.
No course fields, status/grouping/filter logic, price rules, account permissions,
cloud requests, original desktop windows or records were changed. TSX is unchanged.

Tests first failed on the touch rule, then on the padding-aware box model, and
passed after each fix. Full `npm run test:miniapp-ui`, miniapp typecheck, final
weapp build, independent-version/version-classifier/release-matrix and upload
contract tests passed. Only miniapp changes 8.8.22 -> 8.8.23; desktop 8.9.8,
cloud 8.11.21 and NAS 8.8.3 are unchanged. No protocol/schema change.

## Actual runtime evidence

Official DevTools dist project, existing cloud-signed marked test accounts, live
cloud data, no projection mock and no core business writes:

- Baseline `gewu-courses-runtime-20260924-ubgvktf7`: administrator reads 58
  authorized courses, teacher reads one. Both scroll to the last card, exercise
  all five filters, native pull and Return Home. Both report undersized targets;
  this is baseline evidence, not final UI acceptance. Four screenshots inspected.
- `gewu-courses-runtime-20260924-m8ie_7_r`: five-role actual flow passed. Admin
  filter counts: 45/2/11/0 for the four types and 58 after reset. Teacher sees
  one own course. Student/family/visitor direct entry renders no course/filter
  data and Return Home works. All seven screenshots inspected. Source TSX digest
  is retained for comparison to the final patch.
- First final-layout receipt `gewu-courses-runtime-20260924-oh7q0e3a` reported
  passing geometric checks but its screenshots still showed the older 70.6px-wide
  filter boxes. Do not treat that receipt as final visual acceptance. Dist WXSS
  contained border-box while the runtime still used the old compiled style.
  Official `debug_clear_cache cleanCompileCache` plus one refresh corrected it;
  no auth or application-storage cache was cleared. The supplemental harness now
  checks actual runtime box-sizing and the existing right gutter, not only the
  window boundary.

All completed runs restore and synchronously compare original auth and all
`sch_` storage before refreshing the runtime. They do not prove WeChat phone
consent, physical offline/cold login, native back gestures or every page in the
18-route inventory. The long-term multi-end goal remains incomplete.

## Final layout and release

Final layout `gewu-courses-runtime-20260924-efaupul9` exited 0, ok=true, with
authRestored/storageRestored=true. Both staff roles measured every filter at
45px high; the last filter ends at x=332 within the 390px viewport. Actual style
is border-box. Admin's last card ends at y=689.2 inside the list bottom y=719.6;
the teacher's only card is fully visible. All four final screenshots inspected.
This supplements the unchanged-TSX five-role interaction receipt above, not a
second claim to have repeated every flow. Final report SHA256:
`2e7fd19ad977a38fcc2dff5b91754ce2b017331046a970e08c68f60de19060fe`.

Development upload remains pending until its platform receipt is recorded.
