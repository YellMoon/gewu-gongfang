#!/usr/bin/env python3
"""Route the public /scheduling/ prefix to the retired gateway safely."""

import importlib.util
import json
import re
import shlex
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)

LIVE_PATH = "/etc/nginx/sites-enabled/education-platform"
SCHEDULING_PATH = "/scheduling/"
CLOUD_BUSINESS_PATH = "/cloud-business/"
SCHEDULING_UPSTREAM = "http://127.0.0.1:3001/"
CLOUD_BUSINESS_UPSTREAM = "http://127.0.0.1:3002/"
EXPECTED_GATEWAY_VERSION = json.loads(
    (ROOT / "cloud-business-api" / "package.json").read_text(encoding="utf-8")
)["version"]


def quote(value):
    return shlex.quote(value)


def _server_blocks(source):
    blocks = []
    for match in re.finditer(r"\bserver\s*\{", source):
        opening = source.find("{", match.start())
        depth = 0
        for index in range(opening, len(source)):
            if source[index] == "{":
                depth += 1
            elif source[index] == "}":
                depth -= 1
                if depth == 0:
                    blocks.append((match.start(), index + 1, source[match.start():index + 1]))
                    break
        else:
            raise ValueError("NGINX_SCHEDULING_CONFIG_INVALID")
    return blocks


def _https_server(source):
    matches = [
        block
        for block in _server_blocks(source)
        if re.search(r"\blisten\s+443(?:\s+ssl)?\s*;", block[2])
        and re.search(r"\blocation\s+/scheduling/\s*\{", block[2])
    ]
    if len(matches) != 1:
        raise ValueError("NGINX_SCHEDULING_HTTPS_SERVER_INVALID")
    return matches[0]


def _location_match(source, path):
    pattern = re.compile(rf"location\s+{re.escape(path)}\s*\{{(?P<body>[\s\S]*?)\n\s*\}}")
    matches = list(pattern.finditer(source))
    if len(matches) != 1:
        raise ValueError("NGINX_SCHEDULING_LOCATION_INVALID")
    return matches[0]


def _upstream(block):
    matches = re.findall(r"\bproxy_pass\s+(http://[^;\s]+)\s*;", block)
    if len(matches) != 1:
        raise ValueError("NGINX_SCHEDULING_UPSTREAM_INVALID")
    return matches[0]


def patch_nginx_config(source):
    if not isinstance(source, str) or not source.strip():
        raise ValueError("NGINX_SCHEDULING_CONFIG_INVALID")
    server_start, server_end, server_source = _https_server(source)
    scheduling = _location_match(server_source, SCHEDULING_PATH)
    cloud_business = _location_match(server_source, CLOUD_BUSINESS_PATH)
    scheduling_upstream = _upstream(scheduling.group(0))
    cloud_business_upstream = _upstream(cloud_business.group(0))
    if cloud_business_upstream != CLOUD_BUSINESS_UPSTREAM:
        raise ValueError("NGINX_CLOUD_BUSINESS_UPSTREAM_INVALID")
    if scheduling_upstream == SCHEDULING_UPSTREAM:
        return source
    if scheduling_upstream != CLOUD_BUSINESS_UPSTREAM:
        raise ValueError("NGINX_SCHEDULING_UPSTREAM_INVALID")
    scheduling_block = scheduling.group(0)
    updated_block = scheduling_block.replace(
        f"proxy_pass {CLOUD_BUSINESS_UPSTREAM};",
        f"proxy_pass {SCHEDULING_UPSTREAM};",
        1,
    )
    if updated_block == scheduling_block:
        raise ValueError("NGINX_SCHEDULING_UPSTREAM_INVALID")
    updated_server = server_source[:scheduling.start()] + updated_block + server_source[scheduling.end():]
    return source[:server_start] + updated_server + source[server_end:]


def verify_public_contract(ssh):
    output, _ = deploy.run(
        ssh,
        "curl --fail --silent --show-error --max-time 30 "
        "'https://physicsedu.xyz/scheduling/api/health'",
        timeout=45,
    )
    try:
        payload = json.loads(output)
    except json.JSONDecodeError as error:
        raise RuntimeError("NGINX_SCHEDULING_RETIREMENT_HEALTH_INVALID") from error
    if (
        payload.get("ok") is not True
        or payload.get("version") != EXPECTED_GATEWAY_VERSION
        or payload.get("legacyAuthority") != "retired"
    ):
        raise RuntimeError("NGINX_SCHEDULING_RETIREMENT_HEALTH_INVALID")
    for route in (
        "/api/cloud/commands",
        "/api/auth/login",
        "/api/admin/users",
        "/api/permissions/my",
    ):
        status, _ = deploy.run(
            ssh,
            "curl --silent --output /dev/null --write-out '%{http_code}' --max-time 30 "
            f"'https://physicsedu.xyz/scheduling{route}'",
            timeout=45,
        )
        if status.strip() != "410":
            raise RuntimeError("NGINX_SCHEDULING_RETIREMENT_TOMBSTONE_INVALID")
    for route in ("/ws/authority", "/ws/cloud-relay"):
        status, _ = deploy.run(
            ssh,
            "curl --http1.1 --silent --output /dev/null --write-out '%{http_code}' --max-time 30 "
            "--header 'Connection: Upgrade' --header 'Upgrade: websocket' "
            f"'https://physicsedu.xyz/scheduling{route}'",
            timeout=45,
        )
        if not re.fullmatch(r"[1-5][0-9]{2}", status.strip()) or status.strip() == "101":
            raise RuntimeError("NGINX_SCHEDULING_RETIREMENT_WEBSOCKET_INVALID")
    cloud_health, _ = deploy.run(
        ssh,
        "curl --fail --silent --show-error --max-time 30 "
        "'https://physicsedu.xyz/cloud-business/api/health'",
        timeout=45,
    )
    cloud_payload = json.loads(cloud_health)
    if cloud_payload.get("ok") is not True or cloud_payload.get("businessAuthority") != "cloud":
        raise RuntimeError("NGINX_CLOUD_BUSINESS_HEALTH_INVALID")
    return {"gateway": payload, "cloudBusiness": cloud_payload}


def main():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backups/nginx/scheduling-retirement-{stamp}"
    backup_path = backup_dir + "/education-platform.conf"
    temporary_path = f"/etc/nginx/sites-enabled/.education-platform.gewu-{stamp}.tmp"
    ssh = deploy.connect()
    changed = False
    try:
        deploy.run(
            ssh,
            f"mkdir -p {quote(backup_dir)} && "
            f"cp --preserve=all {quote(LIVE_PATH)} {quote(backup_path)}",
        )
        sftp = ssh.open_sftp()
        try:
            with sftp.open(LIVE_PATH, "r") as current_file:
                current = current_file.read().decode("utf-8")
            updated = patch_nginx_config(current)
            changed = updated != current
            if changed:
                with sftp.open(temporary_path, "w") as target:
                    target.write(updated.encode("utf-8"))
        finally:
            sftp.close()
        try:
            if changed:
                deploy.run(
                    ssh,
                    f"chown --reference={quote(LIVE_PATH)} {quote(temporary_path)} && "
                    f"chmod --reference={quote(LIVE_PATH)} {quote(temporary_path)} && "
                    f"mv -f -- {quote(temporary_path)} {quote(LIVE_PATH)}",
                )
            deploy.run(ssh, "nginx -t && systemctl reload nginx", timeout=30)
            evidence = verify_public_contract(ssh)
        except Exception:
            if changed:
                deploy.run(ssh, f"cp --preserve=all {quote(backup_path)} {quote(LIVE_PATH)}")
                deploy.run(ssh, "nginx -t && systemctl reload nginx", timeout=30)
            raise
        print(json.dumps({
            "ok": True,
            "changed": changed,
            "backup": backup_path,
            "gatewayVersion": evidence["gateway"].get("version"),
            "cloudBusinessVersion": evidence["cloudBusiness"].get("version"),
        }, sort_keys=True))
    finally:
        try:
            deploy.run(ssh, f"rm -f -- {quote(temporary_path)}")
        finally:
            ssh.close()


if __name__ == "__main__":
    main()
