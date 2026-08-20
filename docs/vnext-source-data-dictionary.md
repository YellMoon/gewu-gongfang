# Active vNext Full-Business Source Dictionary

Status: active migration-contract baseline on 2026-08-21.

This dictionary is the source-to-target classification contract for the cloud-business-authority migration. The cloud becomes the sole writable authority for applicable business data and structured question-bank text. NAS or the controlled storage agent carries only rich-media bytes, import originals, generated artifacts, and backups; it is not a second business database.

Business tables are not rejected merely because of their domain. Each discovered source relation must instead receive one explicit disposition: `canonical`, `archive`, `local_partition`, `rebuildable_cache`, or `quarantine_only`. A canonical relation needs a source-field mapping, stable identity rule, dependency order, invariant list, target entity, and shadow/restore/rollback evidence before cutover. Unknown relations and critical unavailable sources fail closed; no table is silently ignored or guessed.

The first approved legacy desktop root is inventory-only at this stage. A user-declared absence is not a structural inventory result. Its initial read-only inventory found 99 relations, including non-empty `questions`, `question_contents`, and `question_assets` relations, while the personal-asset relations observed so far are empty. Those relation names and counts do not prove that any question-bank or asset source is admissible. The unexpected non-empty question/asset-labeled relations stay quarantined until their schema, provenance, media boundary, canonical mapping, and owner-approved disposition are verified. Nothing may be filled with synthetic rows, located on another disk/NAS/user profile, or declared migrated merely to resolve the mismatch.

Legacy device/session/offline-license material is not admitted as a current credential. A migrated device may become usable only after the account performs the current online sign-in verification and the cloud silently records the verified device/install/link. Offline edits remain local drafts until the signed-in user confirms submission to the cloud authority.

This document does not claim that a real source table has already been mapped or migrated. The older experimental catalog and export code remain historical references only; they cannot become a default production command, npm script, or data source without the active inventory, shadow-import, restore, rollback, and release gates.

The checked-in structural intake catalog is `migration/vnext/sourceTableCatalog.js`. It pins the 99-relation snapshot, requires a disposition for each relation, and blocks shadow import while any canonical candidate remains `unmapped`. A future `mapped` entry must carry a strict field-to-target contract, stable-ID strategy, dependency order, transformer, invariants, file-reference boundary, and rollback proof; an archive, cache, local-partition, or quarantined relation cannot carry any target mapping.
