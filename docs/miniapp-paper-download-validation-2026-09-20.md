# Miniapp teacher paper editing and download validation

Date: 2026-09-20. This is incremental evidence, not completion of the 18-page/multi-role audit or unified release.

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
