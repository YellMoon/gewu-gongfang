#!/usr/bin/env python3
"""Apply the exact vNext control-plane M20 upgrade through cloud PostgreSQL."""

import argparse
import json
import pathlib
import re
import subprocess

from apply_cloud_postgres_migrations import DockerPsqlExecutor


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_ID = "vnext-pg17-fixed-super-admin-invariant-20"
HASH = re.compile(r"^[0-9a-f]{64}$")


def load_upgrade():
    source = (
        "const value=require('./scripts/vnext-migration/cloudControlPlaneM20Upgrade')"
        ".buildCloudControlPlaneM20UpgradeSql();process.stdout.write(JSON.stringify(value));"
    )
    result = subprocess.run(
        ["node", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8"
    )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M20_CONFIG_INVALID") from error


def validate_upgrade(upgrade):
    if not isinstance(upgrade, dict) or set(upgrade) != {
        "sql", "migrationCount", "migrationId", "semanticVersion", "manifestSha256"
    } or not isinstance(upgrade.get("sql"), str) or not upgrade["sql"].startswith("\\set ON_ERROR_STOP on\n") \
            or upgrade.get("migrationCount") != 1 or upgrade.get("migrationId") != MIGRATION_ID \
            or upgrade.get("semanticVersion") != 20 or not HASH.fullmatch(upgrade.get("manifestSha256", "")):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M20_CONFIG_INVALID")
    return upgrade


def state_sql(upgrade):
    migration_id = upgrade["migrationId"].replace("'", "''")
    manifest_sha256 = upgrade["manifestSha256"]
    query = (
        "SELECT json_build_object("
        "'ledgerCount',count(*),"
        f"'targetCount',count(*) FILTER (WHERE migration_id='{migration_id}' "
        f"AND semantic_version=20 AND manifest_sha256='{manifest_sha256}'),"
        "'indexPresent',to_regclass('vnext_control_plane.vnext_role_grants_one_active_super_admin') IS NOT NULL"
        ")::text FROM vnext_control_plane.vnext_schema_migrations;"
    )
    return "\n".join((
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        "GRANT vnext_pg17_owner TO gewu_app;",
        "SET LOCAL ROLE vnext_pg17_owner;",
        query,
        "RESET ROLE;",
        "REVOKE vnext_pg17_owner FROM gewu_app;",
        "COMMIT;",
        "",
    ))


def read_state(executor, upgrade):
    try:
        value = json.loads(executor.run(state_sql(upgrade)).strip())
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M20_STATE_INVALID") from error
    if not isinstance(value, dict) or set(value) != {"ledgerCount", "targetCount", "indexPresent"} \
            or type(value.get("ledgerCount")) is not int or type(value.get("targetCount")) is not int \
            or type(value.get("indexPresent")) is not bool:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M20_STATE_INVALID")
    return value


def apply_control_plane_m20(executor, upgrade):
    if not hasattr(executor, "run"):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M20_CONFIG_INVALID")
    upgrade = validate_upgrade(upgrade)
    before = read_state(executor, upgrade)
    verified_m20 = before.get("ledgerCount", 0) >= 20 and before.get("targetCount") == 1 and before.get("indexPresent") is True
    if verified_m20:
        return {"applied": [], "skipped": [upgrade["migrationId"]]}
    if before != {"ledgerCount": 19, "targetCount": 0, "indexPresent": False}:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M20_STATE_INVALID")
    executor.run(upgrade["sql"])
    after = read_state(executor, upgrade)
    if after != {"ledgerCount": 20, "targetCount": 1, "indexPresent": True}:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M20_VERIFICATION_FAILED")
    return {"applied": [upgrade["migrationId"]], "skipped": []}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default="gewu-postgres17")
    parser.add_argument("--database", default="gewu_cloud")
    parser.add_argument("--role", default="gewu_app")
    args = parser.parse_args()
    from deploy import connect
    ssh = connect()
    try:
        executor = DockerPsqlExecutor(ssh, args.container, args.database, args.role)
        print(json.dumps(apply_control_plane_m20(executor, load_upgrade()), sort_keys=True))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
