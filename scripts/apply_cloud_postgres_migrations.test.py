import hashlib
import pathlib
import tempfile
import unittest

from apply_cloud_postgres_migrations import (
    DEFAULT_MIGRATION_ROLE,
    DockerPsqlExecutor,
    KNOWN_HISTORICAL_MIGRATION_COMPATIBILITY,
    apply_migrations,
    read_migrations,
)


class FakeExecutor:
    def __init__(self):
        self.applied = {}
        self.calls = []

    def run(self, sql):
        self.calls.append(sql)
        marker = "WHERE name="
        if marker in sql:
            name = sql.split(marker, 1)[1].split(";", 1)[0].strip().strip("'")
            return self.applied.get(name, "") + "\n"
        if "INSERT INTO business.cloud_schema_migrations" in sql:
            values = sql.split("VALUES(", 1)[1].split(")", 1)[0].split(",")
            self.applied[values[0].strip().strip("'")] = values[1].strip().strip("'")
        return ""


class CloudPostgresMigrationTests(unittest.TestCase):
    def test_uses_the_deployed_database_administration_role(self):
        self.assertEqual(DEFAULT_MIGRATION_ROLE, "gewu_app")

    def test_allows_a_docker_container_name_with_hyphens(self):
        executor = DockerPsqlExecutor(object(), "gewu-postgres17", "gewu_cloud", "vnext_pg17_migrator")
        self.assertIn("gewu-postgres17", executor.command)

    def test_reads_only_versioned_sql_in_order(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            (root / "20260823-b.sql").write_text("SELECT 2;\n", encoding="utf-8")
            (root / "20260822-a.sql").write_text("SELECT 1;\n", encoding="utf-8")
            (root / "20260823-b.test.js").write_text("ignored", encoding="utf-8")
            rows = read_migrations(root)
        self.assertEqual([row["name"] for row in rows], ["20260822-a.sql", "20260823-b.sql"])
        self.assertEqual(rows[0]["sha256"], hashlib.sha256(b"SELECT 1;\n").hexdigest())

    def test_applies_once_and_rejects_hash_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            (root / "20260823-a.sql").write_text("BEGIN;\nSELECT 1;\nCOMMIT;\n", encoding="utf-8")
            rows = read_migrations(root)
            executor = FakeExecutor()
            self.assertEqual(apply_migrations(executor, rows), {"applied": ["20260823-a.sql"], "skipped": []})
            self.assertFalse(any("CREATE SCHEMA" in call for call in executor.calls))
            migration_call = next(call for call in executor.calls if "SELECT 1;" in call)
            self.assertIn("SET LOCAL ROLE vnext_pg17_business_owner", migration_call)
            self.assertEqual(apply_migrations(executor, rows), {"applied": [], "skipped": ["20260823-a.sql"]})
            rows[0]["sha256"] = "0" * 64
            with self.assertRaisesRegex(RuntimeError, "CLOUD_MIGRATION_HASH_MISMATCH"):
                apply_migrations(executor, rows)
        self.assertTrue(any("SET LOCAL ROLE vnext_pg17_business_owner" in call for call in executor.calls))

    def test_skips_only_exact_reviewed_historical_to_current_pair(self):
        name = "20260822-miniapp-cloud-accounts.sql"
        historical_hash, current_hash = KNOWN_HISTORICAL_MIGRATION_COMPATIBILITY[name]
        executor = FakeExecutor()
        executor.applied[name] = historical_hash
        rows = [{"name": name, "sql": "BEGIN;\nSELECT 1;\nCOMMIT;\n", "sha256": current_hash}]
        self.assertEqual(apply_migrations(executor, rows), {"applied": [], "skipped": [name]})
        rows[0]["sha256"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "CLOUD_MIGRATION_HASH_MISMATCH"):
            apply_migrations(executor, rows)
        executor.applied[name] = "e" * 64
        with self.assertRaisesRegex(RuntimeError, "CLOUD_MIGRATION_HASH_MISMATCH"):
            apply_migrations(executor, rows)


if __name__ == "__main__":
    unittest.main()
