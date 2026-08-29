#!/usr/bin/env python3
"""Import one approved business-shadow plan into a new isolated cloud database."""

import argparse
import hashlib
import json
import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402

POSTGRES_CONTAINER = "gewu-postgres17"
DATABASE_ROLE = "gewu_app"
PRODUCTION_DATABASE = "gewu_cloud"
REQUIRED_COUNTS = (
    "tenants", "institutions", "schools", "rooms", "teachers", "students",
    "courses", "course_student_pricings", "schedules", "schedule_student_overrides",
)
DATABASE_NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def failure(code):
    return RuntimeError(code)


def quote(value):
    return "'" + str(value).replace("'", "'\\\"'\\\"'") + "'"


def read_plan(plan_dir):
    directory = Path(plan_dir).resolve()
    plan_path = directory / "plan.json"
    sql_path = directory / "import.sql"
    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        sql = sql_path.read_text(encoding="utf-8")
    except (OSError, json.JSONDecodeError) as error:
        raise failure("CLOUD_BUSINESS_SHADOW_PLAN_INVALID") from error
    target = plan.get("shadowTargetIdentity")
    counts = plan.get("relationCounts")
    if (not isinstance(target, str) or DATABASE_NAME.fullmatch(target) is None
            or not isinstance(plan.get("importSqlSha256"), str)
            or SHA256.fullmatch(plan["importSqlSha256"]) is None
            or hashlib.sha256(sql.encode("utf-8")).hexdigest() != plan["importSqlSha256"]
            or not isinstance(counts, dict)
            or set(counts) != set(REQUIRED_COUNTS)
            or any(not isinstance(counts[name], int) or counts[name] < 0 for name in REQUIRED_COUNTS)):
        raise failure("CLOUD_BUSINESS_SHADOW_PLAN_INVALID")
    return directory, plan, sql


def count_query():
    return "SELECT json_build_object(" + ", ".join(
        # Dollar-quoted literals avoid embedding a second single-quoted layer in
        # the remote shell command.  The relation names are a fixed allow-list.
        f"$${name}$$, (SELECT count(*) FROM business.{name})" for name in REQUIRED_COUNTS
    ) + ")::text;"


def database_exists_query(target):
    if not isinstance(target, str) or DATABASE_NAME.fullmatch(target) is None:
        raise failure("CLOUD_BUSINESS_SHADOW_PLAN_INVALID")
    # See count_query(): keep this SQL free of shell-nested single quotes.
    return f"SELECT 1 FROM pg_database WHERE datname = $${target}$$;"


def create_shadow_database_command(target):
    if not isinstance(target, str) or DATABASE_NAME.fullmatch(target) is None:
        raise failure("CLOUD_BUSINESS_SHADOW_PLAN_INVALID")
    # createdb does not take a database-selection flag: it connects to its
    # default maintenance database and creates the validated target.
    return f"docker exec {POSTGRES_CONTAINER} createdb -U {DATABASE_ROLE} {quote(target)}"


def parse_counts(output, expected):
    lines = [line.strip() for line in str(output).splitlines() if line.strip()]
    try:
        observed = json.loads(lines[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise failure("CLOUD_BUSINESS_SHADOW_COUNTS_INVALID") from error
    if not isinstance(observed, dict) or observed != expected:
        raise failure("CLOUD_BUSINESS_SHADOW_COUNTS_MISMATCH")
    return observed


def remote_exec(ssh, command, *, timeout=300):
    output, _ = deploy.run(ssh, command, timeout=timeout)
    return output


def run_shadow_import(plan_dir):
    directory, plan, sql = read_plan(plan_dir)
    target = plan["shadowTargetIdentity"]
    expected = plan["relationCounts"]
    nonce = secrets.token_hex(12)
    remote_dir = f"/tmp/gewu-cloud-business-shadow-{nonce}"
    remote_sql = f"{remote_dir}/import.sql"
    container_sql = f"/tmp/gewu-cloud-business-shadow-{nonce}.sql"
    ssh = deploy.connect()
    created = False
    staged = False
    try:
        existing_database_query = database_exists_query(target)
        exists = remote_exec(
            ssh,
            f"docker exec {POSTGRES_CONTAINER} psql -U {DATABASE_ROLE} -d {PRODUCTION_DATABASE} -tAc {quote(existing_database_query)}",
        ).strip()
        if exists:
            raise failure("CLOUD_BUSINESS_SHADOW_DATABASE_EXISTS")
        remote_exec(ssh, create_shadow_database_command(target))
        created = True
        remote_exec(ssh, f"mkdir -p {quote(remote_dir)}")
        staged = True
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(directory / "import.sql"), remote_sql)
        finally:
            sftp.close()
        remote_exec(ssh, f"docker cp {quote(remote_sql)} {POSTGRES_CONTAINER}:{quote(container_sql)}")
        remote_exec(ssh, f"docker exec {POSTGRES_CONTAINER} psql -U {DATABASE_ROLE} -d {quote(target)} -v ON_ERROR_STOP=1 -f {quote(container_sql)}", timeout=600)
        observed = parse_counts(
            remote_exec(ssh, f"docker exec {POSTGRES_CONTAINER} psql -U {DATABASE_ROLE} -d {quote(target)} -tAc {quote(count_query())}"),
            expected,
        )
        receipt = {
            "ok": True,
            "schema": "gewu.cloud-business-shadow-import.v1",
            "shadowDatabase": target,
            "batchId": plan["batchId"],
            "planSha256": plan["planSha256"],
            "importSqlSha256": plan["importSqlSha256"],
            "relationCounts": observed,
            "quarantinedScheduleCount": plan["quarantinedScheduleCount"],
            "productionDatabaseUntouched": PRODUCTION_DATABASE,
        }
        (directory / "shadow-import-receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return receipt
    except Exception:
        # A failed shadow run is recoverable: only the new isolated database is
        # removed, and production never appears in this command path.
        if created:
            try:
                remote_exec(ssh, f"docker exec {POSTGRES_CONTAINER} dropdb -U {DATABASE_ROLE} -d {PRODUCTION_DATABASE} --if-exists {quote(target)}")
            except Exception:
                pass
        raise
    finally:
        if staged:
            try:
                remote_exec(ssh, f"docker exec -u 0 {POSTGRES_CONTAINER} rm -f -- {quote(container_sql)}; rm -rf -- {quote(remote_dir)}")
            except Exception:
                pass
        ssh.close()


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    args = parser.parse_args(argv)
    print(json.dumps(run_shadow_import(args.plan), ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
