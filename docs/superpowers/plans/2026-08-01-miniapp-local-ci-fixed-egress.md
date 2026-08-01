# Miniapp Local CI Through Existing Fixed Egress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run all miniapp compilation locally while using the existing ECS only as a temporary authenticated fixed-IP network exit, then complete a safe 7.2.10 development upload without degrading production services.

**Architecture:** A loopback-only Python HTTP CONNECT proxy opens destination channels through the existing Paramiko SSH transport. `miniprogram-ci` receives that proxy explicitly, compiles with one local thread, keeps its key local, and records the normal unified-release receipt only on success. Health, egress, concurrency, timeout, and cleanup gates fail closed.

**Tech Stack:** Python 3, Paramiko, `socketserver`, Node.js, `miniprogram-ci@2.1.31`, Taro, npm release matrix.

---

## File map

- Create `scripts/miniapp_fixed_egress.py`: upload lifecycle, loopback proxy, SSH channel forwarding, egress/health checks, lock and cleanup.
- Create `scripts/miniapp_fixed_egress.test.py`: isolated proxy/lifecycle contract tests using fake SSH transports and local sockets.
- Modify `scripts/upload-miniapp.js`: explicit CI proxy, one compiler thread, injectable CI module for behavior tests.
- Modify `scripts/upload-miniapp.test.js`: asynchronous behavior tests that observe `ci.proxy` and the real `ci.upload` options.
- Modify `package.json`: make `miniapp:upload` use the fixed-egress orchestrator and include its test in the backend suite.
- Delete `scripts/upload_miniapp_from_ecs.py`: remove the production-ECS compiler implementation.
- Delete `scripts/upload_miniapp_from_ecs.test.py`: remove tests that asserted the unsafe remote compiler command.
- Modify `task.md`: record RED/GREEN evidence, real upload receipt, production health, process cleanup, and the updated version matrix.

### Task 1: Prove the Node uploader receives the proxy and local thread limit

**Files:**
- Modify: `scripts/upload-miniapp.test.js`
- Modify: `scripts/upload-miniapp.js`

- [ ] **Step 1: Write the failing behavior test**

Add a fake CI module with `proxy`, `Project`, and `upload` functions. Call
`uploadWithMiniprogramCi` with `proxyUrl: 'http://127.0.0.1:18080'` and assert:

```js
assert.strictEqual(observed.proxyUrl, 'http://127.0.0.1:18080');
assert.strictEqual(observed.uploadOptions.threads, 1);
assert.strictEqual(observed.uploadOptions.project, observed.project);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/upload-miniapp.test.js`

Expected: FAIL because the current function cannot inject a CI module, never
calls `ci.proxy`, and omits `threads`.

- [ ] **Step 3: Implement the minimal uploader change**

Allow `options.ci`, resolve an explicit proxy from the option/CLI/environment,
call `ci.proxy(proxyUrl)` before project construction, and pass
`threads: Number(options.threads || 1)` to `ci.upload`.

- [ ] **Step 4: Run GREEN**

Run: `node scripts/upload-miniapp.test.js && node --check scripts/upload-miniapp.js`

Expected: upload-miniapp checks pass and syntax is valid.

### Task 2: Specify the loopback SSH-forwarding lifecycle

**Files:**
- Create: `scripts/miniapp_fixed_egress.test.py`

- [ ] **Step 1: Write failing proxy and safety tests**

Tests must require:

```python
assert parse_connect_target("servicewechat.com:443") == ("servicewechat.com", 443)
assert proxy.server_address[0] == "127.0.0.1"
assert fake_transport.opened == [("direct-tcpip", ("servicewechat.com", 443))]
assert acquire_upload_lock(lock_path).pid == os.getpid()
```

Also require egress mismatch, unhealthy endpoint, oversize header, concurrent
lock, and cleanup-after-child-failure to produce stable error codes.

- [ ] **Step 2: Run RED**

Run: `python scripts/miniapp_fixed_egress.test.py`

Expected: FAIL with missing module/file.

### Task 3: Implement the fixed-egress orchestrator

**Files:**
- Create: `scripts/miniapp_fixed_egress.py`

- [ ] **Step 1: Implement minimal proxy primitives**

Implement a `ThreadingTCPServer` bound to `127.0.0.1` and a handler that reads
one bounded HTTP header, validates CONNECT authority, opens
`transport.open_channel('direct-tcpip', destination, client_address)`, replies
`200 Connection Established`, and relays bytes until EOF/timeout.

- [ ] **Step 2: Implement fail-closed preflight**

Load the existing protected deployment environment through `scripts/deploy.py`.
Verify the release version, production health URLs, local key existence,
expected fixed-egress IP, and an exclusive temp lock before invoking CI.

- [ ] **Step 3: Implement synchronous local upload and unconditional cleanup**

Start the proxy, verify egress through it, then execute:

```python
subprocess.run([
    node_executable(), "scripts/upload-miniapp.js",
    "--upload-mode=miniprogram-ci",
    f"--proxy={proxy.url}",
    "--threads=1",
], cwd=PROJECT_ROOT, env=child_env, check=True, timeout=UPLOAD_TIMEOUT)
```

Always close the proxy, SSH connection, and lock in `finally`; do not create a
remote file, detached process, package install, or compiler process.

- [ ] **Step 4: Run GREEN**

Run: `python scripts/miniapp_fixed_egress.test.py`

Expected: all isolated lifecycle tests pass with no network access.

### Task 4: Retire the remote compiler path and wire the release command

**Files:**
- Modify: `package.json`
- Delete: `scripts/upload_miniapp_from_ecs.py`
- Delete: `scripts/upload_miniapp_from_ecs.test.py`

- [ ] **Step 1: Extend the failing retirement test**

Require the package upload command to reference `miniapp_fixed_egress.py` and
require both retired remote-compiler files to be absent.

- [ ] **Step 2: Run RED**

Run: `python scripts/miniapp_fixed_egress.test.py`

Expected: FAIL because the unsafe remote compiler exists and the package
command still calls `upload-miniapp.js` directly.

- [ ] **Step 3: Delete and rewire**

Delete the two retired files. Change `miniapp:upload` to run the production
release check followed by `python scripts/miniapp_fixed_egress.py`. Add the
Python test to the relevant release/backend verification command.

- [ ] **Step 4: Run GREEN and source audit**

Run:

```text
python scripts/miniapp_fixed_egress.test.py
node scripts/upload-miniapp.test.js
rg -n "ci-runtime|REMOTE_CACHE_BASE|ECS_MINIAPP_UPLOAD_STARTED" scripts package.json
```

Expected: tests pass and the retired remote compilation markers have no formal
release-path match.

### Task 5: Verify locally before touching WeChat

**Files:**
- Modify: `task.md`

- [ ] **Step 1: Run focused verification**

Run:

```text
python scripts/miniapp_fixed_egress.test.py
node scripts/upload-miniapp.test.js
node scripts/release-boundary.test.js
npm run miniapp:release-check
```

Expected: all checks pass and `miniapp/dist/app.json` exists.

- [ ] **Step 2: Run a fixed-egress probe only**

Run the orchestrator in probe mode. Expected: the reported egress equals the
configured WeChat-whitelisted ECS address; production health remains 7.2.10;
proxy/SSH/lock cleanup is zero-residue.

- [ ] **Step 3: Record evidence**

Append RED/GREEN commands, hashes/status, health evidence, and the explicit
boundary “no WeChat upload yet” to `task.md`.

### Task 6: Perform and verify one real development upload

**Files:**
- Modify: `task.md`
- Modify: `output/release-matrix/active.json` only through the release receipt writer

- [ ] **Step 1: Confirm no competing process**

Audit local processes for the old ECS uploader, `miniprogram-ci`, and the new
fixed-egress orchestrator. Expected: zero before start.

- [ ] **Step 2: Run the unified upload command**

Run: `npm run miniapp:upload`

Expected: local Taro build succeeds, fixed egress matches, WeChat returns
`success:true` for 7.2.10, and the unified miniapp receipt becomes verified.

- [ ] **Step 3: Verify production and cleanup**

Recheck both public health endpoints and SSH responsiveness. Audit local and
remote processes; expected: no CI compiler on ECS, no local proxy/upload child,
no lock, and no remote temporary key/directory.

- [ ] **Step 4: Update completion evidence**

Record the WeChat development-upload receipt without claiming review approval
or public miniapp release. Update the unified release matrix and `task.md`.

### Task 7: Final verification and controlled publication

**Files:**
- All files named above

- [ ] **Step 1: Run regression verification**

Run focused tests plus `npm run test:release-matrix` and the relevant backend
release tests. Run `git diff --check` on named source/docs files.

- [ ] **Step 2: Review process/resource safety**

Confirm the current source cannot launch remote npm/miniprogram compilation,
the key remains local, the proxy binds loopback only, and cleanup is guarded by
exact ownership rather than broad process termination.

- [ ] **Step 3: Selectively commit and push**

Stage only the named source/test/doc/task/release-matrix files, excluding
`dist-host`, `dist`, `tmp-*`, logs, local databases, credentials, and generated
unpacked packages. Commit and push to `gewu/master` after verification.

- [ ] **Step 4: Final matrix statement**

Report desktop, host, Backend, Gateway, OSS, and miniapp 7.2.10 evidence. A
development upload is not a WeChat review submission or production rollout.
