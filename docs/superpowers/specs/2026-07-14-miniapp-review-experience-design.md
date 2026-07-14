# Miniapp Review Experience Design

## Goal

Provide a permanent review experience that does not require a verified phone number or manual approval while preserving the existing real-user whitelist, phone binding, and approval boundaries. Reviewers can inspect administrator or student flows and use a fully isolated paper-composition and DOCX/PDF export sandbox. The review path must never read or mutate real business data or enqueue work to the local data host.

## Chosen approach

Three options were considered. A real pre-authorized operating account could expose private records and cannot be bound to an unknown reviewer identity. A client-only review bypass would be an unsafe review-specific backdoor. The selected design uses server-signed synthetic review sessions, an audited static demo dataset, and an in-memory gateway sandbox.

## Identity and authentication

- The login page permanently exposes a Review Experience entry.
- A reviewer enters the code from the review notes and chooses administrator or student experience.
- `POST /api/auth/review-demo` compares the submitted code with `MINIAPP_REVIEW_EXPERIENCE_CODE` using timing-safe comparison. Empty configuration always fails closed.
- Only `admin` and `student` are accepted. A dedicated limiter constrains attempts by IP and code digest.
- A successful request issues a two-hour HS256 JWT with `iss=gewu-review-demo`, `aud=gewu-miniapp-review`, `token_use=review-demo`, a random `session_id`, and the selected role.
- The token has no WeChat openid, phone number, or persisted user row. Normal WeChat login and approval remain unchanged. Review tokens cannot use the normal refresh route.
- Authentication middleware validates review claims strictly and constructs a synthetic identity. Normal tokens still require a matching `users` row. Neither path may fall back to the other.

## Data and authorization isolation

- A focused demo-data module returns deterministic administrator/student snapshots and question previews containing only obvious fictional records.
- Review reads never query `readonly_snapshots`, `users`, `miniapp_tasks`, or the local host.
- Administrator review can browse dashboard, schedules, students, courses, teachers, financial summaries, asset examples, and the question bank. Student review sees only the fictional linked student's schedules and questions.
- `/api/permissions/my` returns `review-demo:read`, one of `review-demo:admin` or `review-demo:student`, `question-bank:view`, and `review-demo:paper-export`. It never returns `users:review`, `question-bank:edit`, or real `business:all`.
- The miniapp maps review capabilities to existing pages and keeps `is_review_demo=true` plus `read_only=true` in the verified identity. Review cache keys are distinct from real-user keys.
- A server-side review firewall rejects every review-session POST, PUT, PATCH, or DELETE with `403 REVIEW_DEMO_READ_ONLY`, except dedicated sandbox routes. A modified client therefore cannot approve users, import finance data, edit teaching data, pair devices, sync, or enqueue host work.

## Paper and export sandbox

- Question preview returns only demo questions and `sandboxAvailable=true`; it does not inspect real snapshots or host heartbeat state.
- Dedicated endpoints create, read, cancel, and download review sandbox tasks. Inputs are restricted to demo question IDs, existing answer placements, and the four existing formula modes, with title, count, body-size, and rate limits.
- Tasks and artifacts live only in gateway process memory, scoped by review `session_id`, and expire after 30 minutes. They never write a database, OSS, or host directory.
- Paper composition returns a completed summary. DOCX and PDF use gateway runtime dependencies to generate files containing demo questions, answers, knowledge points, and explanations. Downloads require the same review JWT.
- The miniapp question-bank page selects sandbox APIs only for a verified review identity. Normal users continue using the existing host task protocol. The two modes use separate local task-cache keys.

## Miniapp experience

- The login page keeps normal WeChat login and adds a separate review card, code field, and administrator/student controls.
- Every review page displays a clear `Review Experience / sanitized sample data / read only` banner.
- Existing write controls are hidden or disabled with a read-only explanation. No fictional feature may be introduced.
- Settings provides Exit Review Experience and clears the review token, business cache, permission cache, and sandbox task cache.
- Wrong code, expired token, expired artifact, and network failure have distinct messages and never fall back to real data or create a pending user.

## Configuration and review material

- The code is never committed. Deployment and readiness checks verify configuration strength without printing the value.
- `docs/miniapp-review-guide.md` documents the permanent entry, both roles, isolation, and sandbox, using an `<review experience code>` placeholder. The private release configuration supplies the actual review note.
- Review copy states that finance pages are sanitized read-only examples and that composition/export occurs only in a sandbox.

## Verification

- Unit tests cover missing/wrong code, role allowlisting, rate limiting, JWT issuer/audience/use, token-type separation, and the absence of persisted-user lookup for review tokens.
- HTTP tests cover both roles, permissions, scoped demo snapshots, question preview, DOCX/PDF generation, cross-session download rejection, expiry, write blocking, and normal-login regression.
- Miniapp tests cover permanent entry visibility, role selection, cache isolation, module mapping, disabled writes, question API routing, exit cleanup, and expiration.
- Final verification runs full `npm test`, production miniapp build, readiness checks, post-deploy public smoke, and both role paths in WeChat Developer Tools.

## Release and rollback

- The final unified version includes both merged pull requests and this review experience. Cloud code and databases are backed up before deployment.
- After development upload, the release notes include a valid code and role instructions. If WeChat OpenAPI remains blocked by error 86000, manual submission/publication is recorded as an external blocker and is not reported as live.
- Rollback restores gateway code and removes `MINIAPP_REVIEW_EXPERIENCE_CODE`; fail-closed configuration leaves normal phone login unaffected.
