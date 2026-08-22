"""Apply cloud SQL migrations through the PostgreSQL container's local socket.

The cloud service account never receives database-owner migration authority or a
migration password.  This runner streams SQL into the existing PostgreSQL
container as the dedicated migration role and records an immutable file hash.
"""

import argparse
import hashlib
import pathlib
import re


MIGRATION_NAME = re.compile(r"^\d{8}-[a-z0-9][a-z0-9-]*\.sql$")
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
DOCKER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


def read_migrations(sql_root):
    root = pathlib.Path(sql_root)
    if not root.is_dir():
        raise RuntimeError("CLOUD_MIGRATION_CONFIG_INVALID")
    rows = []
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        if not path.is_file() or not MIGRATION_NAME.fullmatch(path.name):
            continue
        sql = path.read_text(encoding="utf-8")
        rows.append({"name": path.name, "sql": sql, "sha256": hashlib.sha256(sql.encode("utf-8")).hexdigest()})
    return rows


def sql_literal(value):
    if not isinstance(value, str) or "\x00" in value:
        raise RuntimeError("CLOUD_MIGRATION_CONFIG_INVALID")
    return "'" + value.replace("'", "''") + "'"


def owner_sql(statement):
    return "BEGIN; SET LOCAL ROLE vnext_pg17_business_owner; " + statement + "; COMMIT;\n"


LEDGER_SQL = """
CREATE TABLE IF NOT EXISTS business.cloud_schema_migrations (
  name text COLLATE \"C\" PRIMARY KEY,
  sha256 text COLLATE \"C\" NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
)
""".strip()


def apply_migrations(executor, migrations):
    if not hasattr(executor, "run") or not isinstance(migrations, list):
        raise RuntimeError("CLOUD_MIGRATION_CONFIG_INVALID")
    executor.run(owner_sql(LEDGER_SQL))
    result = {"applied": [], "skipped": []}
    for migration in migrations:
        if not isinstance(migration, dict) or not MIGRATION_NAME.fullmatch(migration.get("name", "")) \
                or not isinstance(migration.get("sql"), str) or not re.fullmatch(r"[0-9a-f]{64}", migration.get("sha256", "")):
            raise RuntimeError("CLOUD_MIGRATION_CONFIG_INVALID")
        existing = executor.run(owner_sql(
            "SELECT sha256 FROM business.cloud_schema_migrations WHERE name=" + sql_literal(migration["name"])
        )).strip()
        if existing:
            if existing != migration["sha256"]:
                raise RuntimeError("CLOUD_MIGRATION_HASH_MISMATCH")
            result["skipped"].append(migration["name"])
            continue
        executor.run(migration["sql"])
        executor.run(owner_sql(
            "INSERT INTO business.cloud_schema_migrations(name,sha256) VALUES("
            + sql_literal(migration["name"]) + "," + sql_literal(migration["sha256"]) + ")"
        ))
        result["applied"].append(migration["name"])
    return result


class DockerPsqlExecutor:
    def __init__(self, ssh, container, database, role):
        if not isinstance(container, str) or not DOCKER_NAME.fullmatch(container) \
                or not all(isinstance(value, str) and IDENTIFIER.fullmatch(value) for value in (database, role)):
            raise RuntimeError("CLOUD_MIGRATION_CONFIG_INVALID")
        self.ssh = ssh
        self.command = "docker exec -i " + container + " psql -X -q -t -A -v ON_ERROR_STOP=1 -U " + role + " -d " + database

    def run(self, sql):
        if not isinstance(sql, str) or not sql.strip():
            raise RuntimeError("CLOUD_MIGRATION_CONFIG_INVALID")
        stdin, stdout, stderr = self.ssh.exec_command(self.command, timeout=120)
        stdin.write(sql)
        stdin.flush()
        stdin.close()
        body = stdout.read().decode("utf-8")
        error = stderr.read().decode("utf-8")
        status = stdout.channel.recv_exit_status()
        if status != 0:
            raise RuntimeError("CLOUD_MIGRATION_PSQL_FAILED: " + error.strip())
        return body


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default="gewu-postgres17")
    parser.add_argument("--database", default="gewu_cloud")
    parser.add_argument("--role", default="vnext_pg17_migrator")
    parser.add_argument("--sql-root", default=str(pathlib.Path(__file__).resolve().parents[1] / "cloud-business-api" / "sql"))
    args = parser.parse_args()
    from deploy import connect
    ssh = connect()
    try:
        result = apply_migrations(DockerPsqlExecutor(ssh, args.container, args.database, args.role), read_migrations(args.sql_root))
        print(result)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
