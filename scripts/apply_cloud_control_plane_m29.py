#!/usr/bin/env python3
"""UTF-8: apply the guarded desktop display-name migration after the backup gate."""
import argparse
import json
import pathlib
import re
import subprocess

try:
    from apply_cloud_postgres_migrations import DockerPsqlExecutor
except ModuleNotFoundError:
    from scripts.apply_cloud_postgres_migrations import DockerPsqlExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_ID = "vnext-pg17-desktop-device-names-29"
STATE_KEYS = {"ledgerCount", "prefixValid", "targetCount", "columnCount", "functionCount", "metadataValid"}

def load_upgrade():
    source = ("const v=require('./scripts/vnext-migration/cloudControlPlaneM29Upgrade').buildCloudControlPlaneM29UpgradeSql();"
              "process.stdout.write(JSON.stringify({...v,stateSql:require('./scripts/vnext-migration/cloudControlPlaneM29State').buildCloudControlPlaneM29StateSql()}));")
    result = subprocess.run(["node", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(result.stdout)

def validate_upgrade(value):
    if (not isinstance(value, dict) or set(value) != {"sql", "migrationCount", "migrationId", "semanticVersion", "manifestSha256", "stateSql"}
        or not isinstance(value.get("sql"), str) or not value["sql"].startswith("\\set ON_ERROR_STOP on\n")
        or value.get("migrationCount") != 1 or value.get("migrationId") != MIGRATION_ID or value.get("semanticVersion") != 29
        or not isinstance(value.get("stateSql"), str) or not value["stateSql"].startswith("WITH expected")
        or not re.fullmatch(r"[0-9a-f]{64}", value.get("manifestSha256", ""))):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M29_CONFIG_INVALID")
    return value

def read_state(executor, upgrade):
    sql = "\n".join(("\\set ON_ERROR_STOP on", "BEGIN;", "GRANT vnext_pg17_owner TO gewu_app;", "SET LOCAL ROLE vnext_pg17_owner;",
                       upgrade["stateSql"], "RESET ROLE;", "REVOKE vnext_pg17_owner FROM gewu_app;", "ROLLBACK;", ""))
    try:
        state = json.loads(executor.run(sql).strip())
    except (TypeError, ValueError) as error:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M29_STATE_INVALID") from error
    if (not isinstance(state, dict) or set(state) != STATE_KEYS
        or any(type(state[key]) is not int for key in ("ledgerCount", "targetCount", "columnCount", "functionCount"))
        or any(type(state[key]) is not bool for key in ("prefixValid", "metadataValid"))):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M29_STATE_INVALID")
    return state

def apply_control_plane_m29(executor, upgrade):
    upgrade = validate_upgrade(upgrade)
    def ready(state):
        return state["ledgerCount"] >= 29 and state["prefixValid"] and state["targetCount"] == 1 and state["columnCount"] == 1 and state["functionCount"] == 2 and state["metadataValid"]
    before = read_state(executor, upgrade)
    if ready(before):
        return {"applied": [], "skipped": [MIGRATION_ID]}
    if before != {"ledgerCount": 28, "prefixValid": True, "targetCount": 0, "columnCount": 0, "functionCount": 0, "metadataValid": False}:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M29_STATE_INVALID")
    executor.run(upgrade["sql"])
    if not ready(read_state(executor, upgrade)):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M29_VERIFICATION_FAILED")
    return {"applied": [MIGRATION_ID], "skipped": []}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default="gewu-postgres17")
    parser.add_argument("--database", default="gewu_cloud")
    parser.add_argument("--role", default="gewu_app")
    args = parser.parse_args()
    from deploy import connect
    ssh = connect()
    try:
        print(json.dumps(apply_control_plane_m29(DockerPsqlExecutor(ssh, args.container, args.database, args.role), load_upgrade()), sort_keys=True))
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
