import unittest
from unittest.mock import patch, MagicMock

import run_real_question_import_submission as subject


class RealQuestionImportSubmissionRunnerTests(unittest.TestCase):
    def test_runtime_never_grants_owner_and_backs_up_before_submission(self):
        exam = 'question_import_task_exam_12345678'
        lecture = 'question_import_task_lecture_12345678'
        receipt = {'ok': True, 'imports': [
            {'taskId': task, 'status': 'submitted', 'submittedCount': 1, 'alreadySubmittedCount': 0}
            for task in (exam, lecture)]}
        commands = []
        def run(ssh, command, **kwargs):
            commands.append(command)
            return (__import__('json').dumps(receipt), '')
        def backup():
            self.assertEqual(commands, [])
            return {'restoreVerified': True, 'ownershipAndPrivilegesVerified': True}
        with patch.object(subject.deploy, 'connect', return_value=MagicMock()), \
                patch.object(subject.deploy, 'run', side_effect=run), \
                patch.object(subject, 'create_backup', side_effect=backup):
            self.assertEqual(subject.run(exam, lecture), {**receipt, 'backup': {'restoreVerified': True, 'ownershipAndPrivilegesVerified': True}})
        self.assertNotIn('GRANT ', '\n'.join(commands))
        self.assertNotIn('REVOKE ', '\n'.join(commands))
        self.assertFalse(commands[0].startswith('rm '))

    def test_backup_failure_prevents_remote_submission(self):
        with patch.object(subject, 'create_backup', side_effect=RuntimeError('backup failed')), \
                patch.object(subject.deploy, 'connect') as connect:
            with self.assertRaisesRegex(RuntimeError, 'backup failed'):
                subject.run('question_import_task_exam_12345678', 'question_import_task_lecture_12345678')
            connect.assert_not_called()

    def test_unverified_backup_prevents_remote_submission(self):
        with patch.object(subject, 'create_backup', return_value={'restoreVerified': False}), \
                patch.object(subject.deploy, 'connect') as connect:
            with self.assertRaisesRegex(RuntimeError, 'BACKUP_NOT_VERIFIED'):
                subject.run('question_import_task_exam_12345678', 'question_import_task_lecture_12345678')
            connect.assert_not_called()

    def test_existing_container_helper_is_not_removed_on_preflight_failure(self):
        commands = []
        def run(ssh, command, **kwargs):
            commands.append(command)
            if 'test ! -e' in command:
                raise RuntimeError('existing helper')
            return ('', '')
        with patch.object(subject, 'create_backup', return_value={'restoreVerified': True, 'ownershipAndPrivilegesVerified': True}), \
                patch.object(subject.deploy, 'connect', return_value=MagicMock()), \
                patch.object(subject.deploy, 'run', side_effect=run):
            with self.assertRaisesRegex(RuntimeError, 'existing helper'):
                subject.run('question_import_task_exam_12345678', 'question_import_task_lecture_12345678')
        self.assertFalse(any('docker exec' in command and 'rm -f' in command for command in commands))

    def test_task_id_validation_accepts_only_import_task_ids(self):
        self.assertEqual(
            subject.valid_task_id("question_import_task_exam_12345678"),
            "question_import_task_exam_12345678",
        )
        for value in ("", "question_import_task_short", "schedule_12345678", "question_import_task_bad;rm"):
            with self.assertRaises(ValueError):
                subject.valid_task_id(value)

    def test_receipt_requires_both_requested_tasks_to_be_submitted(self):
        exam = "question_import_task_exam_12345678"
        lecture = "question_import_task_lecture_12345678"
        payload = {
            "ok": True,
            "imports": [
                {"taskId": exam, "submittedCount": 19, "alreadySubmittedCount": 0, "status": "submitted"},
                {"taskId": lecture, "submittedCount": 88, "alreadySubmittedCount": 0, "status": "submitted"},
            ],
        }
        self.assertEqual(subject.parse_receipt(__import__("json").dumps(payload), exam, lecture), payload)

        payload["imports"][1]["status"] = "drafts_prepared"
        with self.assertRaises(ValueError):
            subject.parse_receipt(__import__("json").dumps(payload), exam, lecture)


if __name__ == "__main__":
    unittest.main()
