#!/usr/bin/env python3
"""Create and verify an append-only PostgreSQL authority backup on the cloud host."""

import argparse
import base64
import contextlib
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
    restore_database = f"gewu_restore_verify_{stamp.replace('-', '_')}"
    security_sql = base64.b64encode((ROOT / 'scripts/cloud_postgres_security_fingerprint.sql').read_bytes()).decode('ascii')
    def security_command(target):
        return (f"printf '%s' '{security_sql}' | base64 -d | docker exec -i '{container}' "
                f"psql -X -v ON_ERROR_STOP=1 -U '{role}' -d {target} --tuples-only --no-align")
    metadata = json.dumps({
        "schema": "gewu.cloud-postgres-backup.v3",
        "createdAtUtc": datetime.strptime(stamp, "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "container": container,
        "database": database,
        "format": "postgres-custom",
        "restore": f"pg_restore --exit-on-error --single-transaction -d NEW_EMPTY_DATABASE {paths['dump']}",
        "restoreScope": "same-cluster-existing-roles; disaster recovery must provision roles separately",
        "ownershipAndPrivilegesVerified": True,
        "verification": {
            "method": "isolated-restore",
            "database": restore_database,
            "requiredObjects": ["business.tenants", "vnext_control_plane.vnext_accounts"],
        },
    }, sort_keys=True, separators=(",", ":"))
    return (
        "set -eu; umask 077; "
        f"backup_dir='{paths['root']}'; dump='{paths['dump']}'; partial='{partial}'; restore_db='{restore_database}'; restore_db_created=0; "
        "test ! -e \"$backup_dir\"; mkdir -p '/root/scheduling-backups/postgres'; mkdir \"$backup_dir\"; "
        f"source_security=$({security_command(chr(39) + database + chr(39))}); test -n \"$source_security\"; "
        f"docker exec '{container}' pg_dump -U '{role}' -d '{database}' --format=custom > \"$partial\"; "
        "test -s \"$partial\"; "
        f"docker exec -i '{container}' pg_restore --list < \"$partial\" > /dev/null; "
        f"existing_restore_db=$(docker exec '{container}' psql -U '{role}' -d postgres --no-psqlrc "
        "--tuples-only --no-align --command \"SELECT 1 FROM pg_database "
        f"WHERE datname='{restore_database}'\"); test -z \"$existing_restore_db\"; "
        "cleanup_restore_db() { status=$?; trap - EXIT; if [ \"$restore_db_created\" = 1 ]; then "
        f"docker exec '{container}' dropdb -U '{role}' --if-exists \"$restore_db\" > /dev/null 2>&1 || status=1; "
        "fi; exit \"$status\"; }; trap cleanup_restore_db EXIT; "
        f"docker exec '{container}' createdb -U '{role}' -T template0 \"$restore_db\"; "
        "restore_db_created=1; "
        f"docker exec -i '{container}' pg_restore -U '{role}' --exit-on-error --single-transaction "
        "-d \"$restore_db\" < \"$partial\"; "
        f"docker exec '{container}' psql -U '{role}' -d \"$restore_db\" --no-psqlrc --tuples-only --no-align "
        "--command \"SELECT to_regclass('business.tenants') IS NOT NULL "
        "AND to_regclass('vnext_control_plane.vnext_accounts') IS NOT NULL "
        "AND EXISTS (SELECT 1 FROM business.tenants)\" | grep -Fx 't'; "
        f"restored_security=$({security_command(chr(34) + '$restore_db' + chr(34))}); "
        "test \"$source_security\" = \"$restored_security\"; "
        f"docker exec '{container}' dropdb -U '{role}' --if-exists \"$restore_db\" > /dev/null; "
        "restore_db_created=0; trap - EXIT; "
        "mv \"$partial\" \"$dump\"; "
        f"cd \"$backup_dir\"; sha256sum 'gewu_cloud.dump' > 'gewu_cloud.dump.sha256'; "
        f"printf '%s\\n' '{metadata}' > 'metadata.json'; "
        "test -s 'gewu_cloud.dump' && sha256sum --check 'gewu_cloud.dump.sha256' > /dev/null && test -s 'metadata.json'; "
        "printf 'securityFingerprint=%s\\n' \"$source_security\"; sha256sum 'gewu_cloud.dump'"
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
    checksum_matches = re.findall(r"(?m)^([0-9a-f]{64})\s+gewu_cloud\.dump\s*$", output)
    if len(checksum_matches) != 1:
        raise RuntimeError("CLOUD_POSTGRES_BACKUP_VERIFICATION_FAILED")
    checksum = checksum_matches[0]
    security_matches = re.findall(r'(?m)^securityFingerprint=([a-f0-9]{32})$', output)
    if len(security_matches) != 1:
        raise RuntimeError('CLOUD_POSTGRES_BACKUP_SECURITY_VERIFICATION_FAILED')
    return {**paths, "sha256": checksum, "restoreVerified": True,
            "ownershipAndPrivilegesVerified": True, "securityFingerprint": security_matches[0]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default="gewu-postgres17")
    parser.add_argument("--database", default="gewu_cloud")
    parser.add_argument("--role", default="gewu_app")
    parser.add_argument("--json", action="store_true", help="Emit only the verified receipt on stdout; diagnostics go to stderr")
    args = parser.parse_args()
    with contextlib.redirect_stdout(sys.stderr) if args.json else contextlib.nullcontext():
        receipt = create_backup(args.container, args.database, args.role)
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
