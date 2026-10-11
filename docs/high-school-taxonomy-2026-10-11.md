# High-school taxonomy reference and child ordering fix

Scope: Chinese, mathematics, English, physics, chemistry, biology, politics,
history, geography, information technology and general technology. Other school
stages and foreign languages are excluded. The shared desktop subject catalog
also feeds the question editor, Word import selector and teacher subject selector.

The reference is `reference-data/zujuan-high-school-2026-10-11.json`, collected
from the public knowledge (`lk_BANK.json`) and method (`j_BANK.json`) trees
linked by https://zujuan.xkw.com/. It contains 11 knowledge trees and five
available method trees: 13,534 nodes including their original library roots.
Each system records its source URL and SHA-256. Node IDs, names, parent-child
relationships, sibling order and original node URLs are retained.

Available method trees are mathematics, physics, chemistry, biology and politics.
The other six method URLs returned HTTP 404; their website knowledge pages also
did not expose a method tab. These six systems remain empty for later editing.
No substitute method nodes were invented.

## Cloud import

`node scripts/import-zujuan-taxonomies.js` validates the complete reference
without contacting or mutating the cloud. `--check-cloud` builds an authenticated
plan. `--apply` sends normal `taxonomy-system.create.v1` and
`taxonomy-node.create.v1` commands through the desktop cloud API. It requires a
current admin session in `GEWU_TAXONOMY_SESSION_TOKEN`; it never prints the token.

The importer preserves existing trees, reuses same-subject systems with the
same name, appends a source library root and uses deterministic imported IDs.
Before any command, it stores the current cloud taxonomy projection and source
hash. Every committed command has a stored receipt; a final cloud read checks
all created fields and total imported IDs. Later manual corrections to already
imported nodes take precedence on reruns. Rejected commands or failed reads stop
the import. Incomplete work can be resumed without duplicating committed nodes.

Current task status: **cloud import verified**.
After the user's online login, the existing device credential resumed through
the normal signed cloud challenge and granted administrator role switch. The
authenticated import committed 21 new systems and 13,534 new nodes, reusing one
existing system. The pre-write backup was created at 2026-10-11T07:18:13.511Z in
`output/taxonomy-import-2026-10-11/taxonomy-before.json`. In the same directory,
`receipts.jsonl` contains 13,555 committed command receipts and `result.json`
confirms all 22 systems, all 13,534 imported IDs and every created field were
read back from the cloud. `evidence-audit.json` independently matches every
receipt to the original planned ID and payload hash. The two original systems
and 76 original nodes were retained. No password or token is stored in the
import evidence.

## Drag regression

rc-tree interprets the upper half of the first child as an inside drop on its
expanded parent. The old planner appended the dragged node to that parent's
children, making a last-child-to-first-child drag appear to do nothing.
Inside drops now prepend the node. Sibling gaps keep their previous rules.

The unit regression fails against the old planner and passes against the fix.
The actual browser test drags a child above its first sibling, drags that child
back down, moves a root to the top, verifies both added subject choices, and
switches to information technology. It checks persisted fixture row ordering,
retains the child's parent, captures screenshots, and reports no page errors.

Evidence: `output/playwright/taxonomy-2026-10-11/checks.json`,
`child-to-top.png` and `subjects.png`. The fixture is isolated from real data.
Importer tests cover source validation, backup-before-write, final readback,
idempotent reruns, preserved edits, and rejected/unauthenticated operations.
The full `npm test`, desktop layout tests and `npm run typecheck` pass. The full
suite exposed an outdated calendar fixture missing `isQuestionBasketVisible`;
its module stub was completed without changing calendar production behavior.

## Compatibility and release

Desktop: 8.19.0. Cloud API: 8.18.2. NAS agent: 8.9.1. Miniapp: 8.10.0.
Cloud, NAS, shared contracts and miniapp sources are unchanged; their compatible
verified receipts are retained after checking the exact component source paths.
The miniapp receipt is a development upload, not a production publication.
Desktop 8.19.0 was pushed to gewu/master, built and published to the OSS update
feed. Production compilation, actual packaged startup and packaged Electron
SQLite ABI checks passed. Packaging restored Node ABI 137 in both dependency
scopes; SQLite GC, backend question-bank and importer/drag checks passed again.
The actual packaged desktop resumed the existing account through normal cloud
authentication and its granted admin role switch in an isolated profile. It
displayed all 11 subject menu entries and the imported physical, information
technology and general technology roots and their first children without page
errors. Runtime evidence is `output/playwright/taxonomy-2026-10-11/packaged-cloud-checks.json`
and the matching `packaged-cloud-13.png`, `packaged-cloud-27.png` and
`packaged-cloud-28.png` screenshots. No real taxonomy ordering was changed by
this read-only UI check; the drag regression used an isolated fixture.
`output/taxonomy-8.19.0-oss-verification.json` confirms the public feed, full
176,431,623-byte installer download SHA-512 and archived feed match the local
artifact. The release source commit is `735608f4`; subsequent changes to this
document only record verification evidence. The unified matrix remains a
partial production release because the unchanged miniapp has a development
upload receipt; desktop OSS publication and cloud taxonomy import are verified.
