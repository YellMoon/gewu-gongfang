#!/usr/bin/env python3
"""Repair the production ACME route and renew the physicsedu.xyz certificate."""

from __future__ import annotations

import importlib.util
import secrets
import shlex
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEPLOY_SPEC = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(DEPLOY_SPEC)
DEPLOY_SPEC.loader.exec_module(deploy)

LIVE_PATH = "/etc/nginx/sites-available/education-platform"
ENABLED_ROOT = "/etc/nginx/sites-enabled"
ENABLED_BACKUP_NAMES = (
    "education-platform.bak-20260627-131419",
    "education-platform.restore3002-20260627-131717",
)
ACME_LOCATION = """    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
"""
CERTBOT_RENEW_COMMAND = (
    "certbot certonly --webroot --webroot-path /var/www/certbot "
    "--cert-name physicsedu.xyz -d physicsedu.xyz -d www.physicsedu.xyz "
    "--force-renewal --deploy-hook 'systemctl reload nginx' --non-interactive"
)


def patch_nginx_config(source: str) -> str:
    if "location /.well-known/acme-challenge/" in source:
        return source
    listen_index = source.find("listen 80;")
    if listen_index < 0:
        raise ValueError("NGINX_HTTP_SERVER_PATTERN_NOT_FOUND")
    catch_all_index = source.find("    location / {", listen_index)
    https_index = source.find("listen 443", listen_index)
    if catch_all_index < 0 or (https_index >= 0 and catch_all_index > https_index):
        raise ValueError("NGINX_HTTP_SERVER_PATTERN_NOT_FOUND")
    return source[:catch_all_index] + ACME_LOCATION + source[catch_all_index:]


def quote(value: str) -> str:
    return shlex.quote(value)


def main() -> None:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_root = f"/root/scheduling-backups/nginx/tls-repair-{stamp}"
    probe = f"gewu-{secrets.token_hex(12)}"
    probe_dir = "/var/www/certbot/.well-known/acme-challenge"
    probe_path = f"{probe_dir}/{probe}"
    ssh = deploy.connect()
    moved = []
    try:
        deploy.run(ssh, f"mkdir -p {quote(backup_root)}")
        deploy.run(ssh, f"cp --preserve=all {quote(LIVE_PATH)} {quote(backup_root + '/education-platform.conf')}")
        for name in ENABLED_BACKUP_NAMES:
            source = f"{ENABLED_ROOT}/{name}"
            target = f"{backup_root}/{name}"
            command = f"if test -f {quote(source)}; then mv -- {quote(source)} {quote(target)}; fi"
            deploy.run(ssh, command)
            moved.append((source, target))

        sftp = ssh.open_sftp()
        try:
            with sftp.open(LIVE_PATH, "r") as remote_file:
                current = remote_file.read().decode("utf-8")
            patched = patch_nginx_config(current)
            if patched != current:
                with sftp.open(LIVE_PATH, "w") as remote_file:
                    remote_file.write(patched.encode("utf-8"))
        finally:
            sftp.close()

        try:
            deploy.run(ssh, "nginx -t && systemctl reload nginx", timeout=30)
        except Exception:
            deploy.run(ssh, f"cp --preserve=all {quote(backup_root + '/education-platform.conf')} {quote(LIVE_PATH)}")
            for source, target in moved:
                deploy.run(ssh, f"if test -f {quote(target)}; then mv -- {quote(target)} {quote(source)}; fi")
            deploy.run(ssh, "nginx -t && systemctl reload nginx", timeout=30)
            raise

        deploy.run(ssh, f"mkdir -p {quote(probe_dir)} && printf %s {quote(probe)} > {quote(probe_path)}")
        challenge_url = f"http://physicsedu.xyz/.well-known/acme-challenge/{probe}"
        out, _ = deploy.run(ssh, f"curl -fsS --max-time 15 {quote(challenge_url)}", timeout=30)
        if out.strip() != probe:
            raise RuntimeError("ACME_HTTP_CHALLENGE_ROUTE_MISMATCH")

        deploy.run(
            ssh,
            CERTBOT_RENEW_COMMAND,
            timeout=180,
        )
        deploy.run(
            ssh,
            "openssl x509 -checkend 2592000 -noout "
            "-in /etc/letsencrypt/live/physicsedu.xyz/fullchain.pem && "
            "openssl x509 -noout -subject -issuer -dates "
            "-in /etc/letsencrypt/live/physicsedu.xyz/fullchain.pem && "
            "nginx -t && systemctl reload nginx && "
            "curl -fsS --max-time 15 https://physicsedu.xyz/scheduling/api/health && "
            "curl -fsS --max-time 15 https://physicsedu.xyz/api/health",
            timeout=60,
        )
        print(f"PRODUCTION_TLS_REPAIRED backup={backup_root}")
    finally:
        try:
            deploy.run(ssh, f"rm -f -- {quote(probe_path)}", timeout=30)
        finally:
            ssh.close()


if __name__ == "__main__":
    main()
