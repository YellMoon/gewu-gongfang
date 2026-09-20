# Miniapp teacher paper editing and download validation

Date: 2026-09-20. This is incremental evidence, not completion of the 18-page/multi-role audit or unified release.

Later strict-domain recheck: the original project's private configuration disables
URL validation. Its successful transfers below do not prove production download
domain permission. The dist window with validation enabled rejects wx.downloadFile
for the cloud origin. Artifact byte/content evidence below remains valid; real
WeChat-domain acceptance and button downloads must be repeated after the platform
configuration is corrected. See miniapp-download-domain-2026-09-20.md.

## Actual teacher workflow

Used the existing WeChat Developer Tools project and a short-lived cloud-signed isolated teacher session. No user login was requested. The two existing selected questions, saved editor draft and previous login storage were restored after the test. Only two intended export tasks were created; no core business records were changed.

- Clicked the global basket and entered the editor. Initial automation read the outgoing page too early. Waiting for a selector on that outgoing Page also timed out. A bounded page-stack check observed the new route on its second read; querying the new Page then found the title field and both score inputs. This fixes the test sequencing, not a claim that every historical simulator startup timeout is solved.
- Actual input changed the first question score from 6 to 7; total changed from 12 to 13. Changed the test title, then clicked Word and PDF export buttons.
- Both cloud tasks progressed to completed: Word `paper_task_b6f7347c-55ac-494e-9f56-10c69cdadcdd`; PDF `paper_task_441d9934-e4ca-4b1d-a123-f551476f9a11`.
- Clicking PDF download reproduced a defect: the UI only displayed the file-preparing/retry toast. It did not continue to download. The pre-fix script's exit 0 covers editing/submission/completion and the click only; it does NOT establish successful download/opening.

Local evidence directory basename: `gewu-teacher-paper-actions-20260920-eydx764s`. Screenshots were opened and inspected.

| Evidence | SHA-256 |
| --- | --- |
| score-edited.png | f798a308aa4fbd2b3f7563a8caef5dd01623e30a381c1f92075eae62eb8771ff |
| exports-completed.png | 9c0edadf7729a622ea9515441c08d97ede8d07adee53e787a1dbab660acc8b9b |
| download-clicked.png | c4bb3de7d1c9b36e39580ac049947c3d37417cbf3356b1cb335c1892ab6c37c7 |

## Scoped repair

- Keep the existing request/read/download delivery REST contract. One user click prepares, polls the same delivery ID while queued/leased, downloads only a ready response and opens it.
- Polling is bounded by 45 seconds of preparation and 12 reads; individual requests retain the API's existing network timeout. Never poll a replacement delivery ID. Failed/expired/unrecognized states stop.
- Capture one session token. Check page/session validity after every asynchronous stage; do not open a previous account's file or display its result after identity changes.
- Provide `pdf` or `docx` explicitly to the native open API because the download relay URL has no document extension. This does not alter file contents or formula format.
- No layout, question selection, course behavior, role grants, database schema or storage protocol was changed. The React interaction remains in the button event handler, not a new effect-driven submission.

## Checks and version scope

- `questionPaperDownload.test.js`: queued/ready, identity changes at four async boundaries, failed/expired states, mismatched ID, time/read limits, invalid file status and missing session. Initially failed due to the absent workflow, passes after implementation.
- `downloadHandler.test.js`: executes the actual page's extracted handler, including prepare/read/download/open ordering and account-switch isolation; passes.
- Both checks are included in miniapp `ci:weapp` via `test:paper-download`.
- Full `test:miniapp-ui`, miniapp typecheck, both builds, independent-version/classifier tests and actual desktop/miniapp export-handler native-formula checks passed. The final 8.8.5 build completed in 23.97 seconds.
- Existing version classifier selected patch: miniapp 8.8.4 -> 8.8.5. Desktop 8.9.8, cloud 8.11.14 and NAS 8.8.3 are not upgraded by this change. The latest cloud renderer fixes are committed separately and are not deployed by this miniapp build.

## Acceptance boundary

The first download-only retest could not install a read-only-result observer on native `wx.openDocument`; the method did not accept replacement. No download button was clicked by that failed attempt. Do not treat it as an application failure or native-open success. The next run uses ordinary real button clicks and sanitized network evidence; only compilation cache was cleared, not user storage or authorization.

Actual native document appearance, the full multi-role course workflows and remaining page audit are still required. The old export-history-before-editor layout remains visible and is not silently redesigned in this repair.

## Development upload and Word network confirmation

- Source commit `5f0f8e443bd798c13b41c185791b349bc92683c7` was pushed to `gewu/master` and independently matched with `ls-remote`.
- WeChat Developer Tools upload of version `8.8.5` returned `success: true`, total package size 1,459,907 bytes. This is development code upload, not production approval or the full release matrix.
- The download-only retest clicked the existing Word task once. Its automator screenshot subsequently timed out; the network tool returned a different question-list entry instead of the requested delivery records. Neither tool result was counted as download success.
- A bounded read of the production nginx access log supplied independent evidence: the same delivery was polled at 02:39:53, :55, :58 and 02:40:02 (Asia/Shanghai), then `/download` returned HTTP 200 and 9,468 bytes at 02:40:02.
- A read-only database transaction tied that delivery to the exact Word task above: `delivery_2b3078ff-7b7a-4498-923d-e1e401d3a57a`, ready, DOCX MIME type, expected bytes 9,468, SHA-256 `f7884a5998a0db095160412d19c3b3c8470d5fedc8dc694af5896ce5c0d79e90`, downloaded_at `2026-09-19T18:40:02.678Z`. This proves real one-click preparation and transfer, not visual Word acceptance.

## PDF click and exact-artifact review

- A fresh teacher UI run clicked the existing PDF task once. Read-only before/after queries show a new ready PDF delivery `delivery_b38d5499-d4c7-4fc2-ac74-609eb270c706` for the exact PDF task, 278,911 bytes, SHA-256 `81b7acbfb7aa9b1c8aa804b180b1e6f0d59e4e4b53315d960e1feb94e936af3c`, downloaded_at `2026-09-19T18:46:12.706Z`.
- Nginx independently records four status reads and an HTTP 200 `/download` response with 278,911 bytes at 02:46:12 Asia/Shanghai. No repeated export task was generated. The test exited 0 and restored the prior login.
- The native simulator screenshot was successfully captured and viewed: `gewu-paper-pdf-download-proof-20260920-d5_0meo4/pdf-downloaded.png`, SHA-256 `87c728c4a0195b68f3a8ff12fdd6d585c4ec92877d6c6ea4b741e95d3f209832`. It shows the editor after download, NOT a native document viewer; do not claim viewer appearance from this screenshot.
- Retrieved the exact two delivery byte arrays for independent local file review, using a read-only database transaction. Both lengths and SHA-256 values match their delivery metadata. These checks do not replace the earlier actual UI download/access-log evidence.
- DOCX ZIP validation passes: 12 native Word equations and zero media files in this two-question sample. This is not a claim about all 108 questions or Word visual layout.
- PDF strict parsing passes, unencrypted, one page with extractable text. Poppler rasterization succeeded and the complete page was opened and inspected: both questions, options, edited scores 7/6, answers and formulas are visible. Existing cloud 8.11.14 still uses its old one-column/template/text-style behavior; the newer local renderer fixes are not yet deployed.
- Exact reviewed files and `review.json` are retained locally under directory basename `gewu-ui-export-artifact-review-20260920-p6u11vyn`. No production question data or core business data was corrected during these checks.
