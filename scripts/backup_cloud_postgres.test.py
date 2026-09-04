import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("backup_cloud_postgres", ROOT / "scripts" / "backup_cloud_postgres.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CloudPostgresBackupTest(unittest.TestCase):
    def test_append_only_verified_custom_dump(self):
        command = MODULE.backup_command("20260824-120000")
        self.assertIn("test ! -e \"$backup_dir\"", command)
        self.assertIn("pg_dump", command)
        self.assertIn("-U 'gewu_app'", command)
        self.assertIn("--format=custom", command)
        self.assertIn("pg_restore --list", command)
        self.assertIn("restore_db='gewu_restore_verify_20260824_120000'", command)
        self.assertIn("createdb -U 'gewu_app' -T template0 \"$restore_db\"", command)
        self.assertIn("pg_restore -U 'gewu_app' --exit-on-error --single-transaction", command)
        self.assertIn("-d \"$restore_db\" < \"$partial\"", command)
        self.assertIn("to_regclass('business.tenants') IS NOT NULL", command)
        self.assertIn("to_regclass('vnext_control_plane.vnext_accounts') IS NOT NULL", command)
        self.assertIn("dropdb -U 'gewu_app' --if-exists \"$restore_db\"", command)
        self.assertIn("trap cleanup_restore_db EXIT", command)
        self.assertIn("SELECT 1 FROM pg_database WHERE datname='gewu_restore_verify_20260824_120000'", command)
        self.assertLess(command.index("SELECT 1 FROM pg_database"), command.index("trap cleanup_restore_db EXIT"))
        self.assertIn("sha256sum --check", command)
        self.assertNotIn("rm -", command)
        paths = MODULE.backup_paths("20260824-120000")
        self.assertEqual(paths["dump"], "/root/scheduling-backups/postgres/20260824-120000/gewu_cloud.dump")

    def test_successful_backup_result_attests_a_completed_restore_probe(self):
        ssh = unittest.mock.Mock()
        with unittest.mock.patch.object(MODULE.deploy, "connect", return_value=ssh), unittest.mock.patch.object(
            MODULE.deploy,
            "run",
            return_value=("t\n" + "a" * 64 + "  gewu_cloud.dump\n", ""),
        ):
            result = MODULE.create_backup(now=MODULE.datetime(2026, 8, 24, 12, 0, 0, tzinfo=MODULE.timezone.utc))
        self.assertIs(result["restoreVerified"], True)

    def test_rejects_shell_metacharacters(self):
        for kwargs in ({"container": "db;id"}, {"database": "gewu-cloud"}, {"role": "postgres root"}):
            with self.assertRaisesRegex(RuntimeError, "CLOUD_POSTGRES_BACKUP_CONFIG_INVALID"):
                MODULE.backup_command("20260824-120000", **kwargs)
        with self.assertRaisesRegex(RuntimeError, "CLOUD_POSTGRES_BACKUP_CONFIG_INVALID"):
            MODULE.backup_paths("latest")


if __name__ == "__main__":
    unittest.main()
