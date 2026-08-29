import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from run_cloud_business_shadow_import import (
    REQUIRED_COUNTS,
    count_query,
    database_exists_query,
    parse_counts,
    read_plan,
)


class CloudBusinessShadowImportTests(unittest.TestCase):
    def valid_counts(self):
        return {name: index for index, name in enumerate(REQUIRED_COUNTS)}

    def write_plan(self, directory, *, sql="SELECT 1;", counts=None, sql_hash=None):
        counts = self.valid_counts() if counts is None else counts
        plan = {
            "shadowTargetIdentity": "gewu_cloud_shadow_20260830",
            "importSqlSha256": sql_hash or hashlib.sha256(sql.encode("utf-8")).hexdigest(),
            "relationCounts": counts,
            "batchId": "business-shadow-1234567890abcdef",
            "planSha256": "a" * 64,
            "quarantinedScheduleCount": 18,
        }
        (directory / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
        (directory / "import.sql").write_text(sql, encoding="utf-8")

    def test_reads_only_an_exact_hashed_plan(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            self.write_plan(directory)
            _, plan, sql = read_plan(directory)
            self.assertEqual(plan["shadowTargetIdentity"], "gewu_cloud_shadow_20260830")
            self.assertEqual(sql, "SELECT 1;")

    def test_rejects_changed_sql_and_mismatched_counts(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            self.write_plan(directory, sql_hash="0" * 64)
            with self.assertRaisesRegex(RuntimeError, "CLOUD_BUSINESS_SHADOW_PLAN_INVALID"):
                read_plan(directory)
            self.write_plan(directory, counts={"students": 60})
            with self.assertRaisesRegex(RuntimeError, "CLOUD_BUSINESS_SHADOW_PLAN_INVALID"):
                read_plan(directory)

    def test_count_query_and_parser_require_exact_relations(self):
        query = count_query()
        self.assertIn("business.students", query)
        self.assertNotIn("'", query)
        expected = self.valid_counts()
        self.assertEqual(parse_counts(json.dumps(expected), expected), expected)
        with self.assertRaisesRegex(RuntimeError, "CLOUD_BUSINESS_SHADOW_COUNTS_MISMATCH"):
            parse_counts(json.dumps({"students": 60}), expected)

    def test_database_check_uses_validated_dollar_quoted_value(self):
        query = database_exists_query("gewu_cloud_shadow_20260830")
        self.assertEqual(query, "SELECT 1 FROM pg_database WHERE datname = $$gewu_cloud_shadow_20260830$$;")
        self.assertNotIn("'", query)
        with self.assertRaisesRegex(RuntimeError, "CLOUD_BUSINESS_SHADOW_PLAN_INVALID"):
            database_exists_query("gewu-cloud-shadow")


if __name__ == "__main__":
    unittest.main()
