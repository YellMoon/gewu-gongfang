# Desktop parser update and supplied-template regression evidence

## Source and boundaries

- Desktop candidate: 8.9.8 (public feed was 8.9.7; candidate keys returned 404).
- Build source: c65b0a6629b39d53aa37c74c998817ad702e4c17.
- Cloud and miniapp deployed source: abc4bc0554273c6ebe64f87e26cfb2bb9dc08ab1.
  The intervening changes are documentation and one export-handler test only;
  production application files are identical.
- Existing six dirty files/hunks and user output directories are excluded.
- Build uses a committed-source archive and independently copied dependencies,
  not a git worktree or a second business-data authority.

## Verified before publication

- Export-handler regression initially failed because a legacy assertion banned
  all drawings, including the supplied template's own layout elements.
  Updated test checks native fraction/exponent OMML, rejects drawings in the
  formula paragraph, rejects added media, and checks retained template media
  byte-for-byte. Desktop and miniapp Word/PDF handlers and retry passed.
- Supplied-template fidelity/page-space test passed; all 74 parser tests passed
  in the frozen source using the packaged Python runtime.
- Version tests, OSS publisher tests and release-matrix tests passed.
- All 15 desktop build-flavor/boundary checks passed. Original workspace Node
  database-module ABI checks passed for both root and backend (ABI 137).
- Frozen-source renderer production compilation succeeded, without a fixture
  build. Installer completion and post-build verification are separate gates.
- Actual packaged executable started with an isolated empty user-data profile.
  Its password-login page rendered, without blocking console/page errors or the
  old identity-verification failure. This is startup evidence, not authenticated
  business-flow acceptance. Its own test process/profile was cleaned up.
- Screenshot inspected: `D:/gewu-desktop-898-20260920-6l4vptlu/packaged-login.png`;
  matching state: `packaged-login-state.json` in the same directory.

## Retained NAS compatibility

NAS stays 8.8.3; no container upload, recreation or update was performed.
A read-only cloud query verified its fresh runtime heartbeat, approved transport
contracts and parser bundle SHA256
`8d3a16cd92f5d01a9bbf8a746dc9115acb6dfb087ec854bc32b9d82e482cf689`.
The release matrix records the original runtime receipt identity, not an invented
health result. This satisfies the desktop compatibility gate without matching
unrelated component version numbers.

## Publication status

Installer build, packaged native-module checks, Node ABI restoration and
post-build export tests completed with exit 0. The build receipt confirms that
all six protected worktree files remain byte-identical.

Desktop 8.9.8 is published to the OSS update feed. All four upload operations
returned HTTP 200. The public installer was streamed in full and matched the
local SHA-512 and size (150307310 bytes); the archived feed equals the active
feed. Installer SHA256:
`082acd54e3dcc685d3724188e2c07ac7301c2cd796fadc1c59892874b8ed240e`.
Packaged parser SHA256:
`da6fadce8940313d51cf27e1986cf3739c77dab3ea465695d04cc7e30075682d`.

Evidence in `D:/gewu-desktop-898-20260920-6l4vptlu/`: `receipt.json`,
`publish-receipt.json` (ok=true), `publish.log`, and the inspected login capture.
Previous 8.9.7 feed is retained as `previous-public-latest.yml`; its existing OSS
release archive is not overwritten. No desktop was installed over user data.

Miniapp 8.8.7 is development-only; complete page/role visual acceptance and
formal WeChat release remain open. The overall project is not fully accepted.
