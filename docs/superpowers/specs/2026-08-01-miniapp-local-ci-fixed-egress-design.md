# Miniapp Local CI Through Existing Fixed Egress Design

## Status and approved direction

The miniapp release pipeline will compile and run `miniprogram-ci` on the local
Windows workstation. The existing Alibaba Cloud ECS remains the fixed public
egress because its address is already admitted by the WeChat upload whitelist,
but it must not install CI dependencies, compile the miniapp, or retain a copy
of the WeChat private key.

The user approved this direction on 2026-08-01. No additional cloud instance,
VPN product, residential static IP, or permanent proxy service is required.

## Root cause being removed

The retired uploader built Taro locally but then copied `miniapp/dist`, the
upload key, and release scripts to the production ECS. Every run created a new
`ci-runtime`, installed `miniprogram-ci@2.1.31` and its transitive dependency
tree, and invoked `ci.upload` on the production host. Its 384 MB Node option
was scoped only to `npm install`, not the compiler, and `ci.upload` did not set
`threads`. The repeated dependency installation plus concurrent WeChat
compilation contended with SSH, Backend, and Gateway on the small production
instance.

## Options considered

1. Buy an independent fixed-IP CI instance. This isolates production, but the
   ongoing cost is not justified for occasional miniapp development uploads.
2. Install WireGuard and route the workstation through ECS. This provides a
   general fixed exit, but requires privileged network-driver and server
   configuration that is broader than the upload problem.
3. Use an upload-scoped SSH forwarding proxy. Selected: the workstation opens
   one authenticated SSH connection and exposes a loopback-only temporary HTTP
   CONNECT proxy. Each proxy destination is opened through Paramiko
   `direct-tcpip`, so WeChat sees the ECS public address while all compilation
   remains local.

## Architecture and data flow

```text
local Taro build
      |
local miniprogram-ci (threads=1, private key remains local)
      |
http://127.0.0.1:<random-port> temporary CONNECT proxy
      |
existing authenticated Paramiko SSH transport / direct-tcpip
      |
existing ECS public egress
      |
WeChat upload API
```

`miniprogram-ci@2.1.31` supports an explicit `ci.proxy(url)` setting. The local
uploader passes the loopback proxy explicitly instead of relying on inherited
system proxy state or `NO_PROXY` behavior.

## Components

### Local fixed-egress orchestrator

`scripts/miniapp_fixed_egress.py` owns the entire lifecycle:

- acquire an exclusive upload lock;
- confirm that no retired ECS upload process is being started locally;
- verify the configured production health endpoints before upload;
- open the existing verified Paramiko SSH connection;
- start a loopback-only HTTP proxy backed by SSH `direct-tcpip` channels;
- query a public IP-check endpoint through that proxy and compare it with the
  configured fixed egress address;
- invoke the existing local `scripts/upload-miniapp.js` synchronously;
- verify the release receipt and production health after upload;
- stop the proxy, close the SSH connection, and release the lock in `finally`.

The proxy accepts local connections only, limits request-header size and
connection lifetime, and is never exposed through the ECS security group.

### Local WeChat uploader

`scripts/upload-miniapp.js` remains the only code that constructs the
`miniprogram-ci` project and records the unified-release receipt. It gains:

- explicit proxy injection through `ci.proxy`;
- one local compiler thread by default;
- validation that fixed-egress orchestration supplies a loopback HTTP proxy;
- no remote path, private-key copy, dependency installation, or detached
  process behavior.

### Release command

`npm run miniapp:upload` performs the local production build/release check and
then invokes the fixed-egress orchestrator. The former remote compiler script
and its remote run/status/cleanup mechanism are removed so it cannot be used
accidentally.

## Safety and failure behavior

- The private key path and contents never leave the workstation.
- No real business or authority data is read or modified by this change.
- An unavailable or unhealthy production service blocks upload before any
  WeChat operation.
- A fixed-egress mismatch blocks upload before `miniprogram-ci` starts.
- A concurrent upload is rejected by the exclusive lock.
- Upload failure does not record a release receipt.
- Proxy, SSH transport, child process, and lock cleanup run for success,
  failure, interruption, and timeout paths.
- ECS receives network forwarding traffic only; no npm, Node compiler, tar
  extraction, temporary upload key, or detached CI process runs there.

## Verification and release gates

1. RED/GREEN Node tests prove proxy injection and `threads: 1` reach the real
   `ci.upload` call.
2. RED/GREEN Python tests prove loopback binding, CONNECT parsing, SSH channel
   delegation, lock behavior, egress mismatch rejection, health gating, and
   unconditional cleanup without a live network dependency.
3. Static retirement checks prove the old ECS compiler script is absent and
   the package upload command uses the new local orchestrator.
4. `npm run miniapp:release-check` builds the production miniapp locally.
5. A controlled proxy probe proves that the public address observed through
   the tunnel equals the configured WeChat-whitelisted ECS egress.
6. One real 7.2.10 development upload must return a WeChat success receipt.
7. Backend and Gateway public health must remain available at the expected
   version before, during, and after the upload, and no upload/proxy process or
   lock may remain afterward.

## Rollback

Before the first real upload, rollback is source-only: restore the previous
package command and scripts without touching the ECS. After a successful
development upload, the uploaded WeChat development version is not a review
submission or public production release; the previous reviewed/released
miniapp remains unchanged. No ECS service or firewall rollback is necessary
because this design installs and persists nothing on the server.
