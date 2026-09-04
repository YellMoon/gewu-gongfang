#!/usr/bin/env python3
"""Apply and verify the exact vNext control-plane M25 desktop session source lock."""
import argparse
import json
import pathlib
import re
import subprocess
from apply_cloud_postgres_migrations import DockerPsqlExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_ID = "vnext-pg17-desktop-session-source-lock-25"
HASH = re.compile(r"^[0-9a-f]{64}$")
STATE_KEYS = {
    "ledgerCount", "targetCount", "startFixed", "exchangeFixed",
    "writerStart", "writerExchange", "publicStart", "publicExchange",
}

def load_upgrade():
    source = "const value=require('./scripts/vnext-migration/cloudControlPlaneM25Upgrade').buildCloudControlPlaneM25UpgradeSql();process.stdout.write(JSON.stringify(value));"
    result = subprocess.run(["node", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(result.stdout)

def validate_upgrade(upgrade):
    if not isinstance(upgrade, dict) or set(upgrade) != {"sql", "migrationCount", "migrationId", "semanticVersion", "manifestSha256"} \
            or not isinstance(upgrade.get("sql"), str) or not upgrade["sql"].startswith("\\set ON_ERROR_STOP on\n") \
            or upgrade.get("migrationCount") != 1 or upgrade.get("migrationId") != MIGRATION_ID \
            or upgrade.get("semanticVersion") != 25 or not HASH.fullmatch(upgrade.get("manifestSha256", "")):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M25_CONFIG_INVALID")
    return upgrade

def state_sql(upgrade):
    start_signature = "vnext_control_plane.vnext_start_desktop_session_challenge(text,text,text,text,timestamp with time zone,timestamp with time zone)"
    exchange_signature = "vnext_control_plane.vnext_exchange_desktop_session_challenge(text,bigint,text,timestamp with time zone,text,text,text,text,text,text,text,text,text)"
    statement = (
        "SELECT json_build_object("
        "'ledgerCount',count(*),"
        "'targetCount',count(*) FILTER (WHERE migration_id='" + upgrade["migrationId"] + "' AND semantic_version=25 AND manifest_sha256='" + upgrade["manifestSha256"] + "'),"
        "'startFixed',(SELECT position('s.status=''active''' in normalized_definition)>0 AND position('s.expires_at>now_at' in normalized_definition)>0 AND position('forshareofs' in normalized_definition)>0 FROM (SELECT lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS normalized_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vnext_control_plane' AND p.proname='vnext_start_desktop_session_challenge') AS target_start_function),"
        "'exchangeFixed',(SELECT position('source_sessionvnext_control_plane.vnext_sessions%rowtype' in normalized_definition)>0 AND position('source_session.status<>''active''' in normalized_definition)>0 AND position('forupdate' in normalized_definition)>0 FROM (SELECT lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS normalized_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vnext_control_plane' AND p.proname='vnext_exchange_desktop_session_challenge') AS target_exchange_function),"
        "'writerStart',has_function_privilege('vnext_pg17_writer','" + start_signature + "','EXECUTE'),"
        "'writerExchange',has_function_privilege('vnext_pg17_writer','" + exchange_signature + "','EXECUTE'),"
        "'publicStart',has_function_privilege('public','" + start_signature + "','EXECUTE'),"
        "'publicExchange',has_function_privilege('public','" + exchange_signature + "','EXECUTE')"
        ")::text FROM vnext_control_plane.vnext_schema_migrations;"
    )
    return "\n".join(("\\set ON_ERROR_STOP on", "BEGIN;", "GRANT vnext_pg17_owner TO gewu_app;", "SET LOCAL ROLE vnext_pg17_owner;",
        statement, "RESET ROLE;", "REVOKE vnext_pg17_owner FROM gewu_app;", "COMMIT;", ""))

def read_state(executor, upgrade):
    try:
        value = json.loads(executor.run(state_sql(upgrade)).strip())
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M25_STATE_INVALID") from error
    if not isinstance(value, dict) or set(value) != STATE_KEYS:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M25_STATE_INVALID")
    return value

def apply_control_plane_m25(executor, upgrade):
    upgrade = validate_upgrade(upgrade)
    before = read_state(executor, upgrade)
    ready = {
        "ledgerCount": 25, "targetCount": 1, "startFixed": True, "exchangeFixed": True,
        "writerStart": True, "writerExchange": True, "publicStart": False, "publicExchange": False,
    }
    pending = {
        "ledgerCount": 24, "targetCount": 0, "startFixed": False, "exchangeFixed": False,
        "writerStart": True, "writerExchange": True, "publicStart": False, "publicExchange": False,
    }
    if before.get("ledgerCount", 0) >= 25 and before.get("targetCount") == 1 \
            and before.get("startFixed") is True and before.get("exchangeFixed") is True \
            and before.get("writerStart") is True and before.get("writerExchange") is True \
            and before.get("publicStart") is False and before.get("publicExchange") is False:
        return {"applied": [], "skipped": [upgrade["migrationId"]]}
    if before != pending:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M25_STATE_INVALID")
    executor.run(upgrade["sql"])
    after = read_state(executor, upgrade)
    if after != ready:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M25_VERIFICATION_FAILED")
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
        print(json.dumps(apply_control_plane_m25(DockerPsqlExecutor(ssh, args.container, args.database, args.role), load_upgrade()), sort_keys=True))
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
