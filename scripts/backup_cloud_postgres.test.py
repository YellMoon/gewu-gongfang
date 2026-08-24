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
        self.assertIn("sha256sum --check", command)
        self.assertNotIn("rm -", command)
        paths = MODULE.backup_paths("20260824-120000")
        self.assertEqual(paths["dump"], "/root/scheduling-backups/postgres/20260824-120000/gewu_cloud.dump")

    def test_rejects_shell_metacharacters(self):
        for kwargs in ({"container": "db;id"}, {"database": "gewu-cloud"}, {"role": "postgres root"}):
            with self.assertRaisesRegex(RuntimeError, "CLOUD_POSTGRES_BACKUP_CONFIG_INVALID"):
                MODULE.backup_command("20260824-120000", **kwargs)
        with self.assertRaisesRegex(RuntimeError, "CLOUD_POSTGRES_BACKUP_CONFIG_INVALID"):
            MODULE.backup_paths("latest")


if __name__ == "__main__":
    unittest.main()
