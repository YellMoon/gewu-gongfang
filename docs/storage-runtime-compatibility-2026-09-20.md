# Retained NAS runtime compatibility - 2026-09-20

The running NAS remains **8.8.3**. No image was built, uploaded, restarted,
replaced, or reconfigured during this check. No component version was bumped.

## Fresh production evidence

A read-only PostgreSQL transaction at `2026-09-19T19:05:16.396354Z` found:

- Agent: `nas-dx4600-agent`, version `8.8.3`.
- Receipt: `storage_runtime_receipt_680bb841-e15a-4078-b6dc-d0d6f2553394`.
- Observation: `2026-09-19T19:03:16.439964Z`, about 120 seconds old.
- Contracts: questionPaperExport `3`, storageAgentTransport `3`,
  questionImportParserProof `1`.
- Parser SHA-256:
  `8d3a16cd92f5d01a9bbf8a746dc9115acb6dfb087ec854bc32b9d82e482cf689`.

The parser hash equals the previously verified immutable image
`gewu-storage-agent:8.8.3-4a4af821`; see
[NAS validation](nas-parser-validation-2026-09-19.md).
The public cloud health endpoint also reported `8.11.14` during this check.
Local evidence directory: `gewu-storage-live-proof-20260920-p80xt73o`.

## Correction and verification

The compatibility declaration still approved only 8.8.2. Added the verified
8.8.3 version, retaining 8.8.2 as the previously reviewed runtime. Protocol
numbers and strict receipt identity/parser checks are unchanged. A future
unreviewed 8.8.4 is still rejected.

The new 8.8.3 regression failed before the configuration change, then passed.
Release matrix, independent versions, Python release matrix, storage runtime
manifest, and cloud storage receipt repository tests passed.

The release-boundary test also exposed an outdated source assertion: migrations
now receive the immutable `source_root`. Updated the assertion to require that
exact argument inside `deploy_frozen_release`; it still requires backup before
gateway retirement verification and migrations. The boundary test, all 56
cloud deployment tests, and all four frozen-source tests passed. No deployment
implementation changed.

## Limits

This proves the retained runtime meets the declared protocols. It does not
claim that later, undeployed parser/image-layout code exists in that image.
The Word visual gate, full page/role acceptance, and remaining release receipts
are still pending; this is not a completed multi-end release.
