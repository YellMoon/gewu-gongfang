# Question intake correction, 2026-10-10

The Desktop source file `Desktop/配速法.docx` reproduced two independent defects:
7 questions parsed, but 6 contained null optional formula preview references
inside option/subquestion documents. The rich-content cleanup only traversed
array-valued content and missed these documents. Cloud media binding then
treated null as a real reference and rejected the complete batch.

The canonical cleanup now traverses document-valued content as well. Cloud
media binding ignores absent optional previews; unallocated real references
remain rejected. No schema, permission, write boundary or transport change.

The unit-format check now matches whole italic tokens, respects unit case,
avoids bare single-letter products, and asks for semantic review of suspected
units. It preserves source italics and removes the erroneous k/v suggestions.
The import page keeps a persistent failure explanation and distinguishes local
draft preparation from cloud submission.

Verification: the original source produces 7 candidates and all pass the
actual cloud repository input validator. Parser warning tests, complete
question-intake tests (including PostgreSQL), and TypeScript checks pass.
The browser regression optionally uses QUESTION_INTAKE_SOURCE to exercise
the original file with the actual page and cloud candidate validation.
Its HTTP rejection and NAS receipts are fixtures, not production receipts.
Evidence is under output/playwright/question-intake-20261006/ and
output/peisu-full-tests-20261010.log. Production deployment and OSS evidence
are recorded in the release matrix only after successful runtime checks.

Release: desktop 8.17.2, cloud business 8.17.1. Miniapp and NAS retain 8.9.1:
their routes, schema and transport contracts are unchanged. Desktop parsing
does not require activation of the new parser on NAS; legacy parser-bound
tasks continue using the deployed NAS revision. The shared cleanup is a
compatible normalization correction, with no new rich-document node type.

Pre-existing workspace edits and screenshots are left outside this commit.
