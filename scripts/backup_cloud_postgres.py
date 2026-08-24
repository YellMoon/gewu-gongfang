#!/usr/bin/env python3
"""Create and verify an append-only PostgreSQL authority backup on the cloud host."""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
DOCKER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
STAMP = re.compile(r"^[0-9]{8}-[0-9]{6}$")


def failure():
    return RuntimeError("CLOUD_POSTGRES_BACKUP_CONFIG_INVALID")


def backup_paths(stamp):
    if not isinstance(stamp, str) or not STAMP.fullmatch(stamp):
        raise failure()
    root = f"/root/scheduling-backups/postgres/{stamp}"
    return {
        "root": root,
        "dump": f"{root}/gewu_cloud.dump",
        "checksum": f"{root}/gewu_cloud.dump.sha256",
        "metadata": f"{root}/metadata.json",
    }


def backup_command(stamp, container="gewu-postgres17", database="gewu_cloud", role="gewu_app"):
    if not isinstance(container, str) or not DOCKER_NAME.fullmatch(container):
        raise failure()
    if not all(isinstance(value, str) and IDENTIFIER.fullmatch(value) for value in (database, role)):
        raise failure()
    paths = backup_paths(stamp)
    partial = paths["dump"] + ".partial"
    metadata = json.dumps({
        "schema": "gewu.cloud-postgres-backup.v1",
        "createdAtUtc": datetime.strptime(stamp, "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "container": container,
        "database": database,
        "format": "postgres-custom",
        "restore": f"pg_restore --clean --if-exists --no-owner --no-privileges -d {database} {paths['dump']}",
    }, sort_keys=True, separators=(",", ":"))
    return (
        "set -eu; umask 077; "
        f"backup_dir='{paths['root']}'; dump='{paths['dump']}'; partial='{partial}'; "
        "test ! -e \"$backup_dir\"; mkdir -p \"$backup_dir\"; "
        f"docker exec '{container}' pg_dump -U '{role}' -d '{database}' --format=custom --no-owner --no-privileges > \"$partial\"; "
        "test -s \"$partial\"; "
        f"docker exec -i '{container}' pg_restore --list < \"$partial\" > /dev/null; "
        "mv \"$partial\" \"$dump\"; "
        f"cd \"$backup_dir\"; sha256sum 'gewu_cloud.dump' > 'gewu_cloud.dump.sha256'; "
        f"printf '%s\\n' '{metadata}' > 'metadata.json'; "
        "test -s 'gewu_cloud.dump' && sha256sum --check 'gewu_cloud.dump.sha256' > /dev/null && test -s 'metadata.json'; "
        "sha256sum 'gewu_cloud.dump'"
    )


def create_backup(container="gewu-postgres17", database="gewu_cloud", role="gewu_app", now=None):
    current = now or datetime.now(timezone.utc)
    stamp = current.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
    paths = backup_paths(stamp)
    ssh = deploy.connect()
    try:
        output, _ = deploy.run(ssh, backup_command(stamp, container, database, role), timeout=600)
    finally:
        ssh.close()
    checksum = output.strip().split()[0] if output.strip() else ""
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise RuntimeError("CLOUD_POSTGRES_BACKUP_VERIFICATION_FAILED")
    return {**paths, "sha256": checksum}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default="gewu-postgres17")
    parser.add_argument("--database", default="gewu_cloud")
    parser.add_argument("--role", default="gewu_app")
    args = parser.parse_args()
    print(json.dumps(create_backup(args.container, args.database, args.role), sort_keys=True))


if __name__ == "__main__":
    main()
