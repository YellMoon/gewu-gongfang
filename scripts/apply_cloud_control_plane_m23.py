#!/usr/bin/env python3
"""Apply and verify the exact vNext control-plane M23 desktop cloud-session contract."""
import argparse
import json
import pathlib
import re
import subprocess
from apply_cloud_postgres_migrations import DockerPsqlExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_ID = "vnext-pg17-desktop-cloud-session-control-23"
HASH = re.compile(r"^[0-9a-f]{64}$")
STATE_KEYS = {"ledgerCount", "targetCount", "challengeRelation", "writerSelect", "writerFunctions", "publicFunctions"}

def load_upgrade():
    source = "const value=require('./scripts/vnext-migration/cloudControlPlaneM23Upgrade').buildCloudControlPlaneM23UpgradeSql();process.stdout.write(JSON.stringify(value));"
    result = subprocess.run(["node", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(result.stdout)

def validate_upgrade(upgrade):
    if not isinstance(upgrade, dict) or set(upgrade) != {"sql", "migrationCount", "migrationId", "semanticVersion", "manifestSha256"} \
            or not isinstance(upgrade.get("sql"), str) or not upgrade["sql"].startswith("\\set ON_ERROR_STOP on\n") \
            or upgrade.get("migrationCount") != 1 or upgrade.get("migrationId") != MIGRATION_ID \
            or upgrade.get("semanticVersion") != 23 or not HASH.fullmatch(upgrade.get("manifestSha256", "")):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M23_CONFIG_INVALID")
    return upgrade

def state_sql(upgrade):
    functions = "'vnext_start_desktop_session_challenge','vnext_exchange_desktop_session_challenge','vnext_read_desktop_session_installation','vnext_rotate_desktop_role_session','vnext_list_desktop_account_devices','vnext_revoke_desktop_device'"
    statement = (
        "SELECT json_build_object("
        "'ledgerCount',count(*),"
        "'targetCount',count(*) FILTER (WHERE migration_id='" + upgrade["migrationId"] + "' AND semantic_version=23 AND manifest_sha256='" + upgrade["manifestSha256"] + "'),"
        "'challengeRelation',to_regclass('vnext_control_plane.vnext_desktop_session_challenges') IS NOT NULL,"
        "'writerSelect',CASE WHEN to_regclass('vnext_control_plane.vnext_desktop_session_challenges') IS NULL THEN false ELSE has_table_privilege('vnext_pg17_writer',to_regclass('vnext_control_plane.vnext_desktop_session_challenges'),'SELECT') END,"
        "'writerFunctions',(SELECT count(*)=6 AND bool_and(has_function_privilege('vnext_pg17_writer',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vnext_control_plane' AND p.proname IN (" + functions + ")),"
        "'publicFunctions',(SELECT COALESCE(bool_or(has_function_privilege('public',p.oid,'EXECUTE')),false) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vnext_control_plane' AND p.proname IN (" + functions + "))"
        ")::text FROM vnext_control_plane.vnext_schema_migrations;"
    )
    return "\n".join(("\\set ON_ERROR_STOP on", "BEGIN;", "GRANT vnext_pg17_owner TO gewu_app;", "SET LOCAL ROLE vnext_pg17_owner;",
        statement, "RESET ROLE;", "REVOKE vnext_pg17_owner FROM gewu_app;", "COMMIT;", ""))

def read_state(executor, upgrade):
    try: value = json.loads(executor.run(state_sql(upgrade)).strip())
    except (json.JSONDecodeError, TypeError, ValueError) as error: raise RuntimeError("CLOUD_CONTROL_PLANE_M23_STATE_INVALID") from error
    if not isinstance(value, dict) or set(value) != STATE_KEYS: raise RuntimeError("CLOUD_CONTROL_PLANE_M23_STATE_INVALID")
    return value

def apply_control_plane_m23(executor, upgrade):
    upgrade = validate_upgrade(upgrade); before = read_state(executor, upgrade)
    ready = {"ledgerCount": 23, "targetCount": 1, "challengeRelation": True, "writerSelect": True, "writerFunctions": True, "publicFunctions": False}
    pending = {"ledgerCount": 22, "targetCount": 0, "challengeRelation": False, "writerSelect": False, "writerFunctions": False, "publicFunctions": False}
    if before.get("ledgerCount", 0) >= 23 and before.get("targetCount") == 1 \
            and before.get("challengeRelation") is True and before.get("writerSelect") is True \
            and before.get("writerFunctions") is True and before.get("publicFunctions") is False:
        return {"applied": [], "skipped": [upgrade["migrationId"]]}
    if before != pending: raise RuntimeError("CLOUD_CONTROL_PLANE_M23_STATE_INVALID")
    executor.run(upgrade["sql"]); after = read_state(executor, upgrade)
    if after != ready: raise RuntimeError("CLOUD_CONTROL_PLANE_M23_VERIFICATION_FAILED")
    return {"applied": [upgrade["migrationId"]], "skipped": []}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--container", default="gewu-postgres17"); parser.add_argument("--database", default="gewu_cloud"); parser.add_argument("--role", default="gewu_app"); args = parser.parse_args()
    from deploy import connect
    ssh = connect()
    try: print(json.dumps(apply_control_plane_m23(DockerPsqlExecutor(ssh, args.container, args.database, args.role), load_upgrade()), sort_keys=True))
    finally: ssh.close()

if __name__ == "__main__": main()
