#!/usr/bin/env python3
"""Apply and verify the desktop-password conflict-target fix in the vNext control plane."""

import argparse
import json
import pathlib
import re
import subprocess

try:
    from apply_cloud_postgres_migrations import DockerPsqlExecutor
except ModuleNotFoundError:  # Supports `python -m unittest scripts/...` from the repo root.
    from scripts.apply_cloud_postgres_migrations import DockerPsqlExecutor


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_ID = "vnext-pg17-desktop-password-conflict-target-fix-28"
HASH = re.compile(r"^[0-9a-f]{64}$")
PASSWORD_FUNCTION = (
    "vnext_control_plane.vnext_set_desktop_password_credential"
    "(text,text,text,text,text,text)"
)
STATE_KEYS = {"ledgerCount", "targetCount", "conflictTargetFixed"}


def load_upgrade():
    source = (
        "const value=require('./scripts/vnext-migration/cloudControlPlaneM28Upgrade')"
        ".buildCloudControlPlaneM28UpgradeSql();"
        "process.stdout.write(JSON.stringify(value));"
    )
    result = subprocess.run(
        ["node", "-e", source],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout)


def validate_upgrade(upgrade):
    if not isinstance(upgrade, dict) or set(upgrade) != {
        "sql", "migrationCount", "migrationId", "semanticVersion", "manifestSha256"
    } or not isinstance(upgrade.get("sql"), str) or not upgrade["sql"].startswith("\\set ON_ERROR_STOP on\n") \
            or upgrade.get("migrationCount") != 1 or upgrade.get("migrationId") != MIGRATION_ID \
            or upgrade.get("semanticVersion") != 28 or not HASH.fullmatch(upgrade.get("manifestSha256", "")):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M28_CONFIG_INVALID")
    return upgrade


def state_sql(upgrade):
    normalized_definition = (
        "lower(regexp_replace(pg_get_functiondef('" + PASSWORD_FUNCTION
        + "'::regprocedure),'[[:space:]]+','','g'))"
    )
    statement = (
        "WITH password_function AS (SELECT " + normalized_definition + " AS definition) "
        "SELECT json_build_object("
        "'ledgerCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations),"
        "'targetCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations WHERE migration_id='"
        + upgrade["migrationId"] + "' AND semantic_version=28 AND manifest_sha256='"
        + upgrade["manifestSha256"] + "'),"
        "'conflictTargetFixed',COALESCE((SELECT position("
        "$target$onconflictonconstraintvnext_desktop_password_credentials_pkeydoupdate$target$ "
        "in definition)>0 AND position("
        "$target$updatevnext_control_plane.vnext_accountsasa$target$ in definition)>0 AND position("
        "$target$wherea.authority_id=p_authority_idanda.account_id=p_account_id$target$ in definition)>0 "
        "FROM password_function),false)"
        ")::text;"
    )
    return "\n".join((
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        "GRANT vnext_pg17_owner TO gewu_app;",
        "SET LOCAL ROLE vnext_pg17_owner;",
        statement,
        "RESET ROLE;",
        "REVOKE vnext_pg17_owner FROM gewu_app;",
        "COMMIT;",
        "",
    ))


def behavior_sql():
    """Exercise both password-credential upsert branches without persisting probe rows."""
    return "\n".join((
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        "GRANT vnext_pg17_owner TO gewu_app;",
        "SET LOCAL ROLE vnext_pg17_owner;",
        "DO $probe$",
        "DECLARE",
        "  probe_suffix text := txid_current()::text;",
        "  probe_authority text := 'm28-probe-authority-' || probe_suffix;",
        "  probe_account text := 'm28-probe-account-' || probe_suffix;",
        "  first_version bigint;",
        "  second_version bigint;",
        "  account_auth_version bigint;",
        "  account_row_version bigint;",
        "BEGIN",
        "  INSERT INTO vnext_control_plane.vnext_authorities(authority_id,status,created_at,updated_at)",
        "  VALUES (probe_authority,'active',transaction_timestamp(),transaction_timestamp());",
        "  INSERT INTO vnext_control_plane.vnext_accounts(account_id,authority_id,status,auth_version,access_version,revocation_version,row_version,created_at,updated_at)",
        "  VALUES (probe_account,probe_authority,'active',1,1,1,1,transaction_timestamp(),transaction_timestamp());",
        "  SELECT result.credential_version INTO first_version",
        "    FROM vnext_control_plane.vnext_set_desktop_password_credential(",
        "      probe_authority,probe_account,'m28.probe.' || probe_suffix,'scrypt-v1','YQ==','Yg=='",
        "    ) AS result;",
        "  SELECT result.credential_version INTO second_version",
        "    FROM vnext_control_plane.vnext_set_desktop_password_credential(",
        "      probe_authority,probe_account,'m28.probe.' || probe_suffix,'scrypt-v1','Yw==','ZA=='",
        "    ) AS result;",
        "  SELECT a.auth_version,a.row_version INTO account_auth_version,account_row_version",
        "    FROM vnext_control_plane.vnext_accounts AS a",
        "    WHERE a.authority_id=probe_authority AND a.account_id=probe_account;",
        "  IF first_version <> 1 OR second_version <> 2",
        "    OR account_auth_version <> 3 OR account_row_version <> 3 THEN",
        "    RAISE EXCEPTION 'VNEXT_DESKTOP_PASSWORD_M28_BEHAVIOR_INVALID' USING ERRCODE='P0001';",
        "  END IF;",
        "END",
        "$probe$;",
        "RESET ROLE;",
        "REVOKE vnext_pg17_owner FROM gewu_app;",
        "ROLLBACK;",
        "",
    ))


def read_state(executor, upgrade):
    try:
        value = json.loads(executor.run(state_sql(upgrade)).strip())
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M28_STATE_INVALID") from error
    if not isinstance(value, dict) or set(value) != STATE_KEYS:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M28_STATE_INVALID")
    return value


def apply_control_plane_m28(executor, upgrade):
    upgrade = validate_upgrade(upgrade)
    before = read_state(executor, upgrade)
    pending = {"ledgerCount": 27, "targetCount": 0, "conflictTargetFixed": False}
    def ready(state):
        return (type(state.get("ledgerCount")) is int and state["ledgerCount"] >= 28
                and state.get("targetCount") == 1 and state.get("conflictTargetFixed") is True)
    if ready(before):
        executor.run(behavior_sql())
        return {"applied": [], "skipped": [upgrade["migrationId"]]}
    if before != pending:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M28_STATE_INVALID")
    executor.run(upgrade["sql"])
    if not ready(read_state(executor, upgrade)):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M28_VERIFICATION_FAILED")
    executor.run(behavior_sql())
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
        print(json.dumps(apply_control_plane_m28(executor, load_upgrade()), sort_keys=True))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
