#!/usr/bin/env python3
"""Apply and verify the exact vNext control-plane M26 device-revocation authorization lock."""

import argparse
import json
import pathlib
import re
import subprocess

from apply_cloud_postgres_migrations import DockerPsqlExecutor


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_ID = "vnext-pg17-desktop-device-revoke-authorization-lock-26"
HASH = re.compile(r"^[0-9a-f]{64}$")
REVOKE_SIGNATURE = "vnext_control_plane.vnext_revoke_desktop_device(text,text,text,text,bigint,text,text,text,text,text,text,text,text,text)"
STATE_KEYS = {
    "ledgerCount",
    "targetCount",
    "actorSessionLocked",
    "accountParentLocked",
    "deviceParentLocked",
    "installationParentLocked",
    "linkParentLocked",
    "activeSuperAdminLocked",
    "writerRevoke",
    "publicRevoke",
}


def load_upgrade():
    source = "const value=require('./scripts/vnext-migration/cloudControlPlaneM26Upgrade').buildCloudControlPlaneM26UpgradeSql();process.stdout.write(JSON.stringify(value));"
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
            or upgrade.get("semanticVersion") != 26 or not HASH.fullmatch(upgrade.get("manifestSha256", "")):
        raise RuntimeError("CLOUD_CONTROL_PLANE_M26_CONFIG_INVALID")
    return upgrade


def state_sql(upgrade):
    definition = (
        "lower(regexp_replace(pg_get_functiondef('" + REVOKE_SIGNATURE
        + "'::regprocedure),'[[:space:]]+','','g'))"
    )
    statement = (
        "WITH revoke_function AS (SELECT " + definition + " AS definition) "
        "SELECT json_build_object("
        "'ledgerCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations),"
        "'targetCount',(SELECT count(*) FROM vnext_control_plane.vnext_schema_migrations WHERE migration_id='"
        + upgrade["migrationId"] + "' AND semantic_version=26 AND manifest_sha256='" + upgrade["manifestSha256"] + "'),"
        "'actorSessionLocked',COALESCE((SELECT "
        "position($lock$selects.*intoactor_sessionfromvnext_control_plane.vnext_sessionsasswheres.authority_id=p_authority_idands.account_id=p_actor_account_idands.session_id=p_actor_session_idforupdate;$lock$ in definition)>0 AND "
        "position($lock$actor_session.status<>'active'$lock$ in definition)>0 AND "
        "position($lock$actor_session.session_kind<>'online'$lock$ in definition)>0 AND "
        "position($lock$actor_session.expires_at<=now_at$lock$ in definition)>0 FROM revoke_function),false),"
        "'accountParentLocked',COALESCE((SELECT "
        "position($lock$selecta.*intoactor_accountfromvnext_control_plane.vnext_accountsasawherea.authority_id=p_authority_idanda.account_id=p_actor_account_idanda.status='active'forshare;$lock$ in definition)>0 AND "
        "position($lock$actor_session.account_auth_version$lock$ in definition)>0 AND "
        "position($lock$actor_session.account_access_version$lock$ in definition)>0 AND "
        "position($lock$actor_session.account_revocation_version$lock$ in definition)>0 AND "
        "position($lock$actor_account.auth_version$lock$ in definition)>0 AND "
        "position($lock$actor_account.access_version$lock$ in definition)>0 AND "
        "position($lock$actor_account.revocation_version$lock$ in definition)>0 FROM revoke_function),false),"
        "'deviceParentLocked',COALESCE((SELECT "
        "position($lock$selectd.*intoactor_devicefromvnext_control_plane.vnext_trusted_devicesasdwhered.authority_id=p_authority_idandd.device_id=actor_session.device_idandd.status='active'forshare;$lock$ in definition)>0 AND "
        "position($lock$actor_session.device_credential_version$lock$ in definition)>0 AND "
        "position($lock$actor_session.device_risk_version$lock$ in definition)>0 AND "
        "position($lock$actor_device.credential_version$lock$ in definition)>0 AND "
        "position($lock$actor_device.risk_version$lock$ in definition)>0 FROM revoke_function),false),"
        "'installationParentLocked',COALESCE((SELECT "
        "position($lock$selecti.*intoactor_installationfromvnext_control_plane.vnext_device_installationsasiwherei.authority_id=p_authority_idandi.device_id=actor_session.device_idandi.installation_id=actor_session.installation_idandi.status='active'forshare;$lock$ in definition)>0 AND "
        "position($lock$actor_session.installation_credential_version$lock$ in definition)>0 AND "
        "position($lock$actor_installation.credential_version$lock$ in definition)>0 FROM revoke_function),false),"
        "'linkParentLocked',COALESCE((SELECT "
        "position($lock$selectl.*intoactor_linkfromvnext_control_plane.vnext_account_device_linksaslwherel.authority_id=p_authority_idandl.account_id=p_actor_account_idandl.device_id=actor_session.device_idandl.installation_id=actor_session.installation_idandl.link_id=actor_session.link_idandl.status='active'forshare;$lock$ in definition)>0 AND "
        "position($lock$actor_session.link_auth_version$lock$ in definition)>0 AND "
        "position($lock$actor_session.link_access_version$lock$ in definition)>0 AND "
        "position($lock$actor_session.link_row_version$lock$ in definition)>0 AND "
        "position($lock$actor_link.auth_version$lock$ in definition)>0 AND "
        "position($lock$actor_link.access_version$lock$ in definition)>0 AND "
        "position($lock$actor_link.row_version$lock$ in definition)>0 FROM revoke_function),false),"
        "'activeSuperAdminLocked',COALESCE((SELECT "
        "position($lock$selectg.*intoactor_grantfromvnext_control_plane.vnext_role_grantsasgwhereg.authority_id=p_authority_idandg.account_id=p_actor_account_idandg.role='super_admin'andg.status='active'andg.starts_at<=now_atand(g.ends_atisnullorg.ends_at>now_at)forshare;$lock$ in definition)>0 AND "
        "position($lock$vnext_desktop_super_admin_required$lock$ in definition)>0 FROM revoke_function),false),"
        "'writerRevoke',has_function_privilege('vnext_pg17_writer','" + REVOKE_SIGNATURE + "','EXECUTE'),"
        "'publicRevoke',has_function_privilege('public','" + REVOKE_SIGNATURE + "','EXECUTE')"
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


def read_state(executor, upgrade):
    try:
        value = json.loads(executor.run(state_sql(upgrade)).strip())
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M26_STATE_INVALID") from error
    if not isinstance(value, dict) or set(value) != STATE_KEYS:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M26_STATE_INVALID")
    return value


def apply_control_plane_m26(executor, upgrade):
    upgrade = validate_upgrade(upgrade)
    before = read_state(executor, upgrade)
    ready = {
        "ledgerCount": 26,
        "targetCount": 1,
        "actorSessionLocked": True,
        "accountParentLocked": True,
        "deviceParentLocked": True,
        "installationParentLocked": True,
        "linkParentLocked": True,
        "activeSuperAdminLocked": True,
        "writerRevoke": True,
        "publicRevoke": False,
    }
    pending = {
        "ledgerCount": 25,
        "targetCount": 0,
        "actorSessionLocked": False,
        "accountParentLocked": False,
        "deviceParentLocked": False,
        "installationParentLocked": False,
        "linkParentLocked": False,
        "activeSuperAdminLocked": False,
        "writerRevoke": True,
        "publicRevoke": False,
    }
    if before == ready:
        return {"applied": [], "skipped": [upgrade["migrationId"]]}
    if before != pending:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M26_STATE_INVALID")
    executor.run(upgrade["sql"])
    after = read_state(executor, upgrade)
    if after != ready:
        raise RuntimeError("CLOUD_CONTROL_PLANE_M26_VERIFICATION_FAILED")
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
        print(json.dumps(apply_control_plane_m26(executor, load_upgrade()), sort_keys=True))
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
