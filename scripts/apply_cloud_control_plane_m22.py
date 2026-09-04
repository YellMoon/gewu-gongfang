#!/usr/bin/env python3
"""Apply the exact vNext control-plane M22 canonical phone reader grant."""
import argparse
import json
import pathlib
import re
import subprocess
from apply_cloud_postgres_migrations import DockerPsqlExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_ID = "vnext-pg17-desktop-canonical-phone-reader-22"
HASH = re.compile(r"^[0-9a-f]{64}$")

def load_upgrade():
    source = "const value=require('./scripts/vnext-migration/cloudControlPlaneM22Upgrade').buildCloudControlPlaneM22UpgradeSql();process.stdout.write(JSON.stringify(value));"
    result = subprocess.run(["node", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(result.stdout)

def validate_upgrade(upgrade):
    if not isinstance(upgrade, dict) or set(upgrade) != {"sql", "migrationCount", "migrationId", "semanticVersion", "manifestSha256"} \
            or not isinstance(upgrade.get("sql"), str) or not upgrade["sql"].startswith("\\set ON_ERROR_STOP on\n") \
            or upgrade.get("migrationCount") != 1 or upgrade.get("migrationId") != MIGRATION_ID \
            or upgrade.get("semanticVersion") != 22 or not HASH.fullmatch(upgrade.get("manifestSha256", "")):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M22_CONFIG_INVALID")
    return upgrade

def state_sql(upgrade):
    return "\n".join(("\\set ON_ERROR_STOP on", "BEGIN;", "GRANT vnext_pg17_owner TO gewu_app;", "SET LOCAL ROLE vnext_pg17_owner;",
        "SELECT json_build_object('ledgerCount',count(*),'targetCount',count(*) FILTER (WHERE migration_id='" + upgrade["migrationId"] + "' AND semantic_version=22 AND manifest_sha256='" + upgrade["manifestSha256"] + "'),'readerPrivilege',has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_verified_contacts','SELECT'))::text FROM vnext_control_plane.vnext_schema_migrations;",
        "RESET ROLE;", "REVOKE vnext_pg17_owner FROM gewu_app;", "COMMIT;", ""))

def read_state(executor, upgrade):
    try: value = json.loads(executor.run(state_sql(upgrade)).strip())
    except (json.JSONDecodeError, TypeError, ValueError) as error: raise RuntimeError("CLOUD_CONTROL_PLANE_M22_STATE_INVALID") from error
    if not isinstance(value, dict) or set(value) != {"ledgerCount", "targetCount", "readerPrivilege"}: raise RuntimeError("CLOUD_CONTROL_PLANE_M22_STATE_INVALID")
    return value

def apply_control_plane_m22(executor, upgrade):
    upgrade = validate_upgrade(upgrade); before = read_state(executor, upgrade)
    if before.get("ledgerCount", 0) >= 22 and before.get("targetCount") == 1 and before.get("readerPrivilege") is True: return {"applied": [], "skipped": [upgrade["migrationId"]]}
    if before != {"ledgerCount": 21, "targetCount": 0, "readerPrivilege": False}: raise RuntimeError("CLOUD_CONTROL_PLANE_M22_STATE_INVALID")
    executor.run(upgrade["sql"]); after = read_state(executor, upgrade)
    if after != {"ledgerCount": 22, "targetCount": 1, "readerPrivilege": True}: raise RuntimeError("CLOUD_CONTROL_PLANE_M22_VERIFICATION_FAILED")
    return {"applied": [upgrade["migrationId"]], "skipped": []}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--container", default="gewu-postgres17"); parser.add_argument("--database", default="gewu_cloud"); parser.add_argument("--role", default="gewu_app"); args = parser.parse_args()
    from deploy import connect
    ssh = connect()
    try: print(json.dumps(apply_control_plane_m22(DockerPsqlExecutor(ssh, args.container, args.database, args.role), load_upgrade()), sort_keys=True))
    finally: ssh.close()

if __name__ == "__main__": main()
