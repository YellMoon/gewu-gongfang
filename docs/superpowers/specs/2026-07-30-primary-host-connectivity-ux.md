# Primary-host connectivity UX

## Decision

The primary-host desktop application must remain usable through the cloud relay
without a Windows firewall rule. LAN direct connection is an optional
same-network acceleration capability, not a prerequisite for sign-in, device
approval, command delivery, projection refresh, or update checks.

## User-facing behavior

1. The product navigation calls the page **系统与数据 → 系统参数**. It must not
   refer to an unavailable “系统设置” menu.
2. A primary host shows a Chinese **局域网直连（可选）** section. It explains that
   cloud relay is already available and that LAN direct connection is useful
   only for authorized devices on the same private network.
3. The default is disabled. No startup path, background health check, update
   check, identity activation, or cloud-relay operation may request elevation
   or require an inbound firewall rule.
4. When the user deliberately chooses **启用局域网直连**, the application
   explains the exact scope (installed primary-host executable, Private
   profile, LocalSubnet, TCP host port) before requesting the single Windows
   administrator approval. The existing narrow rule helper remains the only
   rule writer.
5. If permission is declined, unavailable, or later removed, the page reports
   that LAN direct connection is unavailable while cloud relay continues to
   work. It must never direct the user to create a rule manually.
6. The transport selector retains LAN WebSocket → relay WebSocket → durable
   relay ordering. LAN unavailability is retryable transport reachability and
   falls through to the relay transports; an authorization or business
   rejection does not fall through to a different transport.

## Implementation boundaries

- Keep the firewall helper restricted to packaged primary-host executables,
  Private profile, LocalSubnet, and one TCP port.
- Expose an explicit, localized renderer state for cloud relay availability and
  LAN direct availability. Do not infer a firewall failure from general
  network status.
- Do not modify real authority data, device grants, question stores, or user
  profiles while testing. All validation uses existing unit fixtures and
  isolated packaged-desktop profiles.

## Verification

- RED tests prove that ordinary/cloud-relay behavior does not depend on LAN
  firewall state and that the primary-host page offers no manual-rule advice.
- UI/source tests prove the localized optional-LAN wording, explicit enable
  action, and no elevation at startup.
- Transport tests prove an unavailable LAN transport reaches relay WebSocket
  or durable relay with the same signed envelope and receipt semantics.
- A rebuilt isolated host/client pair verifies a device approval and command
  flow with LAN disabled and without any firewall rule. A separate LAN row is
  attempted only when the isolated environment can safely provide its own
  connection capability; it is never a release blocker for cloud-relay
  usability.

## Non-goals

- Do not broaden the firewall rule, open public-network access, or make the
  cloud a business-data authority.
- Do not claim the full architecture release complete until the existing
  isolated LAN, relay, restart, role, and synchronization matrix has current
  evidence.
