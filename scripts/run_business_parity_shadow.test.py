import unittest
import pathlib
import subprocess
import tempfile
import io
import tarfile
import copy
from unittest.mock import patch
from run_business_parity_shadow import validate_backup, validate_target, export_committed_source, run, shadow_drop_command
from business_parity_student_balance import seed_student_balance
from business_parity_student_history import seed_student_history, verify_student_history, verify_course_history, verify_retained_course_actions


class BusinessParityShadowGuardTest(unittest.TestCase):
    def test_cleanup_force_is_limited_to_exact_disposable_target(self):
        target='gewu_ui_shadow_'+'a'*16
        self.assertEqual(shadow_drop_command(target),"docker exec gewu-postgres17 dropdb -U gewu_app --if-exists --force '"+target+"'")
        for bad in ['gewu_cloud','postgres','gewu_ui_shadow_','gewu_ui_shadow_'+'a'*16+"'; drop database gewu_cloud;--"]:
            with self.subTest(target=bad),self.assertRaises((ValueError,RuntimeError)): shadow_drop_command(bad)

    def test_rejects_mixed_retained_action_targets_before_connection(self):
        for course_flag in ['course_delete_history_only','retained_course_actions_only']:
            with self.subTest(course_flag=course_flag),self.assertRaisesRegex(ValueError,'RETAINED_ACTION_SCOPE_CONFLICT'):
                run('not-a-backup',retained_student_actions_only=True,**{course_flag:True})
        with self.assertRaisesRegex(ValueError,'REFRESH_ACTION_SCOPE_CONFLICT'):
            run('not-a-backup',course_refresh_only=True,retained_student_actions_only=True)
        for flag in ['course_refresh_only','retained_student_actions_only','course_confirmation_only']:
            with self.assertRaisesRegex(ValueError,'COURSE_ACTIVE_SCOPE_CONFLICT'):
                run('not-a-backup',course_active_only=True,**{flag:True})

    def test_retained_course_actions_exact_history(self):
        before = {'student': {'id': 'student', 'name': '原学生'}}
        before.update({key: [{'id': str(i)} for i in range(count)] for key, count in [
            ('courses', 1), ('schedules', 1), ('course_student_pricings', 1), ('schedule_student_overrides', 1), ('payments', 2), ('consumptions', 1)]})
        before['courses'][0].update(legacy_deleted=False, updated_at='old')
        before['schedules'][0].update(id='lesson', legacy_deleted=False, updated_at='old', created_at='old',
            start_at='2026-09-08T01:00:00+00:00', end_at='2026-09-08T02:30:00+00:00', calculated_tuition=270,
            calculated_teacher_fee=180, teacher_name='原教师')
        before['schedule_student_overrides'][0].update(schedule_id='lesson', tuition=180, teacher_fee=120)
        after = copy.deepcopy(before); after['courses'][0].update(legacy_deleted=True, updated_at='new')
        after['schedules'][0].update(start_at='2026-09-09T01:00:00+00:00', end_at='2026-09-09T03:00:00+00:00',
            calculated_tuition=360, calculated_teacher_fee=240, updated_at='new')
        copy_id='12345678-1234-4234-8234-123456789abc'
        copied={**after['schedules'][0], 'id':copy_id, 'created_at':'new', 'legacy_deleted':True,
                'start_at':'2026-09-10T01:00:00+00:00', 'end_at':'2026-09-10T03:00:00+00:00'}
        after['schedules'].append(copied)
        after['schedule_student_overrides'].append({**before['schedule_student_overrides'][0], 'schedule_id':copy_id})
        self.assertTrue(verify_retained_course_actions(before,after,copy_id)['copyDeletedAfterUndo'])
        for table,field in [('schedules','calculated_tuition'),('schedules','teacher_name'),('courses','name'),
                            ('schedule_student_overrides','tuition'),('payments','amount'),('consumptions','amount')]:
            bad=copy.deepcopy(after);bad[table][0][field]='wrong'
            with self.subTest(table=table,field=field), self.assertRaises(RuntimeError):
                verify_retained_course_actions(before,bad,copy_id)
        for table in ('schedules','schedule_student_overrides'):
            bad=copy.deepcopy(after);bad[table].pop()
            with self.assertRaises(RuntimeError): verify_retained_course_actions(before,bad,copy_id)
        # UTF-8: the student-only deletion keeps its parent course unchanged.
        before['student'].update(legacy_deleted=False,updated_at='old')
        after['courses']=copy.deepcopy(before['courses'])
        after['student']={**before['student'],'legacy_deleted':True,'updated_at':'new'}
        self.assertTrue(verify_retained_course_actions(before,after,copy_id,student_deleted=True)['studentRemainsDeleted'])
        for key in ['student','courses','schedules','schedule_student_overrides','payments','consumptions']:
            bad=copy.deepcopy(after)
            if key=='student': bad[key]['legacy_deleted']=False
            else: bad[key][0]['unexpected']='drift'
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                verify_retained_course_actions(before,bad,copy_id,student_deleted=True)

    def test_course_history_rejects_cascade_and_student_changes(self):
        before = {'student': {'id': 'student', 'name': '原学生'}}
        before.update({key: [{'id': str(i)} for i in range(count)] for key, count in [
            ('courses', 1), ('schedules', 1), ('course_student_pricings', 1), ('schedule_student_overrides', 1), ('payments', 2), ('consumptions', 1)]})
        for key in ('courses', 'schedules'): before[key][0].update(legacy_deleted=False, updated_at='old')
        after = copy.deepcopy(before)
        after['courses'][0].update(legacy_deleted=True, updated_at='new')
        self.assertTrue(verify_course_history(before, after)['lessonsStillActive'])
        for key in before:
            changed = copy.deepcopy(after)
            if key == 'student': changed[key]['name'] = 'Changed'
            elif key == 'courses': changed[key][0]['name'] = 'Changed'
            else: changed[key] = []
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'COURSE_DELETE_HISTORY_CHANGED'):
                verify_course_history(before, changed)

    def test_history_verifier_detects_cascade_and_metadata_changes(self):
        # UTF-8: reject history loss, not only a missing student in the UI.
        before = {'student': {'id': 'test', 'legacy_deleted': False, 'updated_at': 'old', 'name': 'Original'}}
        before.update({key: [{'id': str(i)} for i in range(count)] for key, count in [
            ('courses', 1), ('schedules', 1), ('course_student_pricings', 1), ('schedule_student_overrides', 1), ('payments', 2), ('consumptions', 1)]})
        for key in ('courses', 'schedules'): before[key][0]['legacy_deleted'] = True
        after = copy.deepcopy(before)
        after['student'].update(legacy_deleted=True, updated_at='new')
        self.assertTrue(verify_student_history(before, after)['historicalRecordsUnchanged'])
        active_before, active_after = copy.deepcopy(before), copy.deepcopy(after)
        for snapshot in (active_before, active_after):
            for key in ('courses', 'schedules'): snapshot[key][0]['legacy_deleted'] = False
        self.assertFalse(verify_student_history(active_before, active_after, parents_deleted=False)['referencesArchived'])
        with self.assertRaisesRegex(RuntimeError, 'STUDENT_HISTORY_BASELINE_INVALID'):
            verify_student_history(active_before, active_after, parents_deleted=True)
        for key in before:
            changed = copy.deepcopy(after)
            if key == 'student': changed[key]['name'] = 'Changed'
            else: changed[key] = []
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'STUDENT_DELETE_HISTORY_CHANGED'):
                verify_student_history(before, changed)
        class WrongDb:
            def run(self, sql):
                if sql != 'SELECT current_database()': raise AssertionError('must not write to wrong database')
                return 'gewu_cloud'
        with self.assertRaisesRegex(RuntimeError, 'ISOLATED_SHADOW_REQUIRED'):
            seed_student_history(WrongDb(), 'gewu_ui_shadow_' + 'a' * 16)

    def test_ledger_fixture_refuses_nonisolated_database_before_writing(self):
        class FakeDb:
            def __init__(self, database): self.database, self.calls = database, []
            def run(self, sql):
                self.calls.append(sql)
                return self.database if sql == 'SELECT current_database()' else 'test-teacher'
        target = 'gewu_ui_shadow_' + 'a' * 16
        for requested, actual in [('gewu_cloud', 'gewu_cloud'), (target, 'gewu_cloud')]:
            db = FakeDb(actual)
            with self.assertRaisesRegex(RuntimeError, 'ISOLATED_SHADOW_REQUIRED'):
                seed_student_balance(db, requested)
            self.assertFalse(any('INSERT' in sql for sql in db.calls))
        db = FakeDb(target)
        result = seed_student_balance(db, target)
        self.assertEqual(result['name'], '余额核验学生')
        self.assertEqual(len(db.calls), 3)
        self.assertIn('IF current_database()<>', db.calls[-1])
        self.assertIn('SET LOCAL ROLE vnext_pg17_business_owner', db.calls[-1])
        self.assertNotIn('UPDATE ', db.calls[-1])
        self.assertNotIn('DELETE ', db.calls[-1])

    def test_rejects_escaping_and_linked_archive_entries_before_extraction(self):
        for name, kind in [('cloud-business-api/../../escape', tarfile.REGTYPE),
                           ('/absolute', tarfile.REGTYPE), ('other/file', tarfile.REGTYPE),
                           ('shared/link', tarfile.SYMTYPE), ('shared/hardlink', tarfile.LNKTYPE)]:
            payload = io.BytesIO()
            with tarfile.open(fileobj=payload, mode='w') as archive:
                item = tarfile.TarInfo(name); item.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE): item.linkname = '../../escape'
                archive.addfile(item)
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix='gewu-archive-guard-test-') as temp:
                destination = pathlib.Path(temp) / 'rejected'
                with patch('run_business_parity_shadow.subprocess.run', return_value=subprocess.CompletedProcess([], 0, payload.getvalue())):
                    with self.assertRaisesRegex(RuntimeError, 'UNSAFE_SOURCE_ARCHIVE'):
                        export_committed_source(temp, 'a'*40, destination)
                self.assertFalse(destination.exists())

    def test_snapshot_excludes_dirty_and_untracked_cloud_changes(self):
        with tempfile.TemporaryDirectory(prefix='gewu-source-snapshot-test-') as temp:
            repo = pathlib.Path(temp) / 'repo'; repo.mkdir()
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=repo).decode('utf-8').strip()
            git('init', '-q')
            paths = ['cloud-business-api/src/app.js', 'cloud-business-api/scripts/start.js',
                     'cloud-business-api/sql/original.sql', 'cloud-business-api/server.js',
                     'cloud-business-api/package.json', 'shared/contract.js']
            for name in paths:
                file = repo / name; file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('committed source', encoding='utf-8')
            git('add', '--', 'cloud-business-api', 'shared')
            git('-c', 'user.name=Snapshot Test', '-c', 'user.email=snapshot@example.invalid', 'commit', '-qm', 'fixture')
            commit = git('rev-parse', 'HEAD')
            dirty = repo / paths[0]; dirty.write_text('paused user change', encoding='utf-8')
            untracked = repo / 'cloud-business-api/sql/paused.sql'
            untracked.write_text('must not deploy', encoding='utf-8')
            destination = pathlib.Path(temp) / 'snapshot'
            self.assertEqual(export_committed_source(repo, commit, destination), destination)
            self.assertEqual((destination / paths[0]).read_text(encoding='utf-8'), 'committed source')
            self.assertFalse((destination / 'cloud-business-api/sql/paused.sql').exists())
            self.assertFalse((destination / '.git').exists())
            self.assertEqual(dirty.read_text(encoding='utf-8'), 'paused user change')
            self.assertTrue(untracked.exists())
            with self.assertRaises(FileExistsError):
                export_committed_source(repo, commit, destination)
            for invalid in ['HEAD', '', '--output=elsewhere', 'a'*40+';id']:
                with self.subTest(ref=invalid), self.assertRaisesRegex(RuntimeError, 'EXACT_SOURCE_COMMIT_REQUIRED'):
                    export_committed_source(repo, invalid, pathlib.Path(temp) / 'rejected')
            self.assertFalse((pathlib.Path(temp) / 'rejected').exists())

    def backup(self):
        root = '/root/scheduling-backups/postgres/20260907-083758'
        return dict(root=root, dump=root+'/gewu_cloud.dump', sha256='a'*64,
                    restoreVerified=True, ownershipAndPrivilegesVerified=True, securityFingerprint='b'*32)

    def test_requires_security_preserving_backup(self):
        self.assertEqual(validate_backup(self.backup()), self.backup())
        for key in ('ownershipAndPrivilegesVerified','securityFingerprint','restoreVerified','sha256'):
            value = self.backup(); del value[key]
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError,'VERIFIED_BACKUP_REQUIRED'):
                validate_backup(value)

    def test_never_accepts_production_or_arbitrary_restore_targets(self):
        self.assertEqual(validate_target('gewu_ui_shadow_'+'a'*16),'gewu_ui_shadow_'+'a'*16)
        for name in ('gewu_cloud','postgres','gewu_ui_shadow_','gewu_ui_shadow_'+'a'*16+';id'):
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError,'ISOLATED_SHADOW_REQUIRED'):
                validate_target(name)
        value = self.backup(); value['dump']='/root/live/gewu_cloud.dump'
        with self.assertRaisesRegex(RuntimeError,'VERIFIED_BACKUP_REQUIRED'):
            validate_backup(value)


if __name__ == '__main__': unittest.main()
