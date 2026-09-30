# Cloud operation audit contract

`20260930-operation-audits.sql` must be applied before running the updated cloud API. The production server requires an audit repository; a missing repository or failed intent insert returns `503 CLOUD_OPERATION_AUDIT_UNAVAILABLE` before the covered business operation runs. The optional app-factory injection exists only for older test fixtures.

## Persistence and outcome

Every covered authenticated write first commits an immutable intent, with the verified account/device, server tenant and database timestamp. Before the JSON response is sent, the server awaits insertion of an immutable outcome. Both tables deny the application writer direct reads, inserts, updates and deletes; only the three security-definer functions are exposed. Outcomes have a unique intent ID and cannot be replaced through those functions.

If the process exits, a handler fails without producing JSON, or outcome persistence fails, the durable intent remains visible as `unknown`. An outcome persistence failure does not turn an already committed business change into a retryable HTTP failure: the original response is preserved and includes `audit: {id,status:'unknown'}`. A successful recorded result includes `audit: {id,status:'success'}`. This design deliberately does not assert that business SQL and the audit outcome share a transaction. Unknown entries require investigation; they are never synthesized as success.

`success` means that the cloud endpoint accepted/completed the request. For asynchronous imports, exports and delivery requests it means successful task submission, not completion of the background task. Question command receipts that return HTTP 200 with rejected/conflict outcomes are recorded as rejected/conflict.

## Covered writes

- All POST/PUT/PATCH/DELETE paths under `/api/business/{schedules,students,teachers,rooms,courses,institutions,schools,payments,consumptions,grades,personal-asset-categories,personal-asset-records}`, including student records/contacts and schedule student overrides.
- Desktop question commands, question imports and draft preparation, question asset relay/delivery, paper export requests and cancellation.
- Miniapp personal asset imports, paper export requests/cancellation/delivery and question asset delivery.

Invalid or expired credentials cannot produce an attributed audit and are rejected before intent creation. Authentication, registration, account/device management, role application reviews, storage-agent worker events, direct database administration and historical local changes are outside this operation log. Malformed JSON rejected by Express before routing is also outside this log. This is not a claim of complete system/security auditing.

## Query authorization

`GET /api/desktop/operation-audits` accepts `limit` (1–100, default 20), `offset` (0–1000000), `q`, `action`, `status`, and inclusive ISO timestamps `from`/`to`. Search is literal case-insensitive substring matching. Sorting is newest first. Count and page use a single database snapshot, including an accurate total when the page is empty.

The active desktop role is authoritative: `super_admin` reads only the configured tenant, `teacher` reads only that account's operations within the configured tenant; student/visitor roles are denied. No request parameter selects another tenant/account. Database scope parameters are trusted server parameters, not independently authenticated database identities.

The response is `{success:true,data:{items,total,scope:'tenant'|'self'}}`. Each item contains `id,createdAt,actorId,actorName,deviceId,action,resourceType,resourceId,status,summary,detail`. Names may be null when absent from the verified session; the account ID remains available. Miniapp device IDs may be null because miniapp sessions do not establish a desktop device.

## Change details and privacy

`detail.request` contains whitelisted scalar values and bounded arrays/nested fields. Other field values become `[redacted]`; request headers, tokens, password values, phone values, free-form names/notes and full question text are not retained. `detail.result` contains only returned object ID and version/timestamp. `detail.httpStatus`, `code`, and `completedAt` describe the result. The resource ID can be null for newly generated asynchronous tasks; their returned ID is under `detail.result.id` when available.

`changeCapture:'submitted-fields-only'` is intentional. These are submitted fields and the returned version, **not before/after database snapshots**. No pre-write lookup is presented as a transactional before value. Exact before/after capture would require changes inside each existing transactional mutation function; this release does not fabricate it.

## Verification

Run `node src/operationAudit.test.js` and `node sql/operation-audits.postgres.test.js` from `cloud-business-api`. The first exercises HTTP success/conflict/error/rejection, actual active-role scoping, filter validation, intent-before-effect ordering, fail-closed start, preserved business success on outcome failure, command-receipt conflicts and redaction. The second starts an isolated disposable PostgreSQL 17 runtime, applies the migration twice, verifies cross-connection persistence, pending/unknown outcomes, teacher/tenant isolation, pagination/filtering and rejection of direct modification or duplicate outcomes. It only stops its own disposable runtime.
