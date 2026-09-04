#!/usr/bin/env python3
"""Apply and verify the canonical family-member role in the vNext control plane."""

import argparse
import json
import pathlib
import re
import subprocess

from apply_cloud_postgres_migrations import DockerPsqlExecutor


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_ID = "vnext-pg17-family-member-canonical-role-27"
HASH = re.compile(r"^[0-9a-f]{64}$")
STATE_KEYS = {"ledgerCount", "targetCount", "familyMemberRole"}


def load_upgrade():
    source = "const value=require('./scripts/vnext-migration/cloudControlPlaneM27Upgrade').buildCloudControlPlaneM27UpgradeSql();process.stdout.write(JSON.stringify(value));"
    result = subprocess.run(["node", "-e", source], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(result.stdout)


def validate_upgrade(upgrade):
    if not isinstance(upgrade, dict) or set(upgrade) != {"sql", "migrationCount", "migrationId", "semanticVersion", "manifestSha256"} \
            or not isinstance(upgrade.get("sql"), str) or not upgrade["sql"].startswith("\\set ON_ERROR_STOP on\n") \
            or upgrade.get("migrationCount") != 1 or upgrade.get("migrationId") != MIGRATION_ID \
            or upgrade.get("semanticVersion") != 27 or not HASH.fullmatch(upgrade.get("manifestSha256", "")):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M27_CONFIG_INVALID")
    return upgrade


def state_sql(upgrade):
    statement = (
        "WITH role_constraint AS ("
        "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint "
        "WHERE conrelid='vnext_control_plane.vnext_role_grants'::regclass "
        "AND conname='vnext_role_grants_role_check'),"
        "constraint_roles AS (SELECT role_match[1] AS role_name FROM role_constraint "
        "CROSS JOIN LATERAL regexp_matches(definition,$role$'([^']+)'$role$,'g') AS matched_roles(role_match)) "
        "SELECT json_build_object("
        "'ledgerCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations),"
        "'targetCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations WHERE migration_id='"
        + upgrade["migrationId"] + "' AND semantic_version=27 AND manifest_sha256='" + upgrade["manifestSha256"] + "'),"
        "'familyMemberRole',COALESCE((SELECT "
        "array_agg(role_name ORDER BY role_name)=ARRAY['family_member','student','super_admin','teacher']::text[] "
        "FROM constraint_roles),false)"
        ")::text;"
    )
    return "\n".join(("\\set ON_ERROR_STOP on", "BEGIN;", "GRANT vnext_pg17_owner TO gewu_app;", "SET LOCAL ROLE vnext_pg17_owner;", statement, "RESET ROLE;", "REVOKE vnext_pg17_owner FROM gewu_app;", "COMMIT;", ""))


def read_state(executor, upgrade):
    try:
        value = json.loads(executor.run(state_sql(upgrade)).strip())
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M27_STATE_INVALID") from error
    if not isinstance(value, dict) or set(value) != STATE_KEYS:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M27_STATE_INVALID")
    return value


def apply_control_plane_m27(executor, upgrade):
    upgrade = validate_upgrade(upgrade)
    before = read_state(executor, upgrade)
    pending = {"ledgerCount": 26, "targetCount": 0, "familyMemberRole": False}
    def ready(state):
        return (isinstance(state.get("ledgerCount"), int) and state["ledgerCount"] >= 27
                and state.get("targetCount") == 1 and state.get("familyMemberRole") is True)
    if ready(before):
        return {"applied": [], "skipped": [upgrade["migrationId"]]}
    if before != pending:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M27_STATE_INVALID")
    executor.run(upgrade["sql"])
    if not ready(read_state(executor, upgrade)):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M27_VERIFICATION_FAILED")
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
        print(json.dumps(apply_control_plane_m27(DockerPsqlExecutor(ssh, args.container, args.database, args.role), load_upgrade()), sort_keys=True))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
