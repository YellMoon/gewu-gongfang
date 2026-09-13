"""Only disposable local repositories; no network or deployment credentials."""
import io
import pathlib
import subprocess
import tarfile
import tempfile
import unittest
import os
import sys
from unittest import mock

import cloud_release_source as source


class FrozenCloudSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='gewu-source-test-')
        self.addCleanup(self.temp.cleanup)
        self.repo = pathlib.Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Local source test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'core.autocrlf', 'false')
        for name in ('cloud-business-api/src/app.js', 'cloud-business-api/sql/20260913-lease.sql',
                     'shared/value.js', 'scripts/apply_cloud_postgres_migrations.py',
                     'backend/assets/fonts/NotoSansCJKsc-Regular.otf', 'package.json',
                     'miniapp/package.json', 'storage-agent/package.json', 'config/release-compatibility.json'):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('committed\n', encoding='utf-8', newline='\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        self.commit = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, text=True, encoding='utf-8')

    def test_dirty_and_untracked_inputs_cannot_enter_build_or_migration(self):
        app = self.repo / 'cloud-business-api/src/app.js'
        app.write_text('paused user work\n', encoding='utf-8', newline='\n')
        pending = self.repo / 'cloud-business-api/sql/20260914-paused.sql'
        pending.write_text('must not deploy\n', encoding='utf-8', newline='\n')
        with source.frozen_cloud_inputs(self.repo, self.commit[:12]) as snapshot:
            self.assertEqual((snapshot / 'cloud-business-api/src/app.js').read_text(encoding='utf-8'), 'committed\n')
            self.assertFalse((snapshot / pending.relative_to(self.repo)).exists())
            self.assertEqual((snapshot / 'cloud-business-api/sql/20260913-lease.sql').read_text(encoding='utf-8'), 'committed\n')
            self.assertTrue((snapshot / 'scripts/apply_cloud_postgres_migrations.py').is_file())
            self.assertFalse((snapshot / '.git').exists())
        self.assertFalse(snapshot.exists())
        self.assertEqual(app.read_text(encoding='utf-8'), 'paused user work\n')
        self.assertTrue(pending.exists())
        self.assertEqual(len(self.git('worktree', 'list', '--porcelain').split('worktree ')) - 1, 1)

    def test_old_revision_and_injected_ref_are_rejected(self):
        self.git('commit', '--allow-empty', '-qm', 'next')
        for ref in (self.commit, 'HEAD', '--output=bad', '../bad'):
            with self.assertRaisesRegex(ValueError, 'CLOUD_RELEASE_SOURCE'):
                with source.frozen_cloud_inputs(self.repo, ref):
                    self.fail('must not yield')

    def test_archive_links_and_parent_traversal_are_rejected(self):
        for name, kind in (('../escape', tarfile.REGTYPE), ('shared/link', tarfile.SYMTYPE)):
            payload = io.BytesIO()
            with tarfile.open(fileobj=payload, mode='w') as archive:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = '/outside'
                archive.addfile(member)
            with mock.patch.object(source, 'archive_bytes', return_value=payload.getvalue()):
                with self.assertRaisesRegex(ValueError, 'CLOUD_RELEASE_SOURCE_ARCHIVE_INVALID'):
                    with source.frozen_cloud_inputs(self.repo, self.commit):
                        self.fail('must not yield')

    def test_real_snapshot_imports_migration_runtime_without_workspace_files(self):
        repo = pathlib.Path(__file__).resolve().parents[1]
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
        with source.frozen_cloud_inputs(repo, commit) as snapshot:
            probe = ('import sys, importlib; sys.path.insert(0,"scripts"); '
                     'modules=[importlib.import_module("apply_cloud_control_plane_m"+str(n)) for n in range(20,29)]; '
                     '[m.validate_upgrade(m.load_upgrade()) for m in modules]; '
                     'import deploy; from apply_cloud_postgres_migrations import read_migrations; '
                     'rows=read_migrations("cloud-business-api/sql"); '
                     'assert rows; '
                     'print("snapshot runtime and committed migrations ready")')
            result = subprocess.run([sys.executable, '-c', probe], cwd=snapshot,
                                    env={**os.environ, 'DOTENV_CONFIG_PATH': str(snapshot / 'absent.env')},
                                    capture_output=True, text=True, encoding='utf-8', timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('snapshot runtime and committed migrations ready', result.stdout)


if __name__ == '__main__':
    unittest.main()
