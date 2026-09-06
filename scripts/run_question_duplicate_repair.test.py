import json
import unittest
from unittest.mock import MagicMock, patch

import run_question_duplicate_repair as repair


class QuestionDuplicateRepairRunnerTest(unittest.TestCase):
    @patch("run_question_duplicate_repair.deploy.connect")
    @patch("run_question_duplicate_repair.deploy.run")
    @patch("run_question_duplicate_repair.verified_backup")
    def test_failed_backup_prevents_upload_and_mutation(self, backup, run_command, connect):
        ssh = MagicMock()
        connect.return_value = ssh
        backup.side_effect = ValueError("QUESTION_DUPLICATE_REPAIR_BACKUP_INVALID")
        with self.assertRaisesRegex(ValueError, "BACKUP_INVALID"):
            repair.run("apply")
        ssh.open_sftp.assert_not_called()
        self.assertEqual(run_command.call_count, 1, 'only the read-only deployed image check may run')
        ssh.close.assert_called_once()

    @patch("run_question_duplicate_repair.backup_cloud_postgres.create_backup")
    def test_backup_must_be_restore_verified_and_have_recovery_location(self, create_backup):
        for value in ({}, {"restoreVerified": False}, {"restoreVerified": True, "root": "/tmp/not-a-backup", "sha256": "a" * 64}):
            create_backup.return_value = value
            with self.assertRaisesRegex(ValueError, "BACKUP_INVALID"):
                repair.verified_backup()

    def test_parse_dry_run_receipt(self):
        payload = {
            "ok": True,
            "mode": "dry-run",
            "ready": True,
            "malformedActiveCount": 14,
            "canonicalActiveCount": 2,
            "snapshotReferenceCount": 4,
            "snapshotTaskCount": 2,
            "snapshotSetSha256": repair.EXPECTED_SNAPSHOT_SET_SHA256,
            "targetIdentitySetSha256": "b" * 64,
            "activePublishedCount": 16,
            "activePublishedOptionCount": 29,
            "activePublishedSourceCount": 2,
            "commandReceiptCount": 0,
            "commandReceiptSetSha256": None,
        }
        self.assertEqual(repair.parse_receipt(json.dumps(payload), "dry-run"), payload)

    def test_parse_apply_receipt(self):
        payload = {
            "ok": True,
            "mode": "apply",
            "replayed": False,
            "deletedCount": 14,
            "malformedActiveCount": 0,
            "canonicalActiveCount": 2,
            "snapshotReferenceCount": 4,
            "snapshotTaskCount": 2,
            "snapshotSetSha256": repair.EXPECTED_SNAPSHOT_SET_SHA256,
            "targetIdentitySetSha256": "b" * 64,
            "activePublishedCount": 2,
            "activePublishedOptionCount": 8,
            "activePublishedSourceCount": 2,
            "commandReceiptCount": 14,
            "commandReceiptSetSha256": "a" * 64,
        }
        self.assertEqual(repair.parse_receipt(f"diagnostic\n{json.dumps(payload)}", "apply"), payload)

    def test_parse_rejects_wrong_snapshot_or_counts(self):
        base = {
            "ok": True,
            "mode": "apply",
            "replayed": False,
            "deletedCount": 14,
            "malformedActiveCount": 0,
            "canonicalActiveCount": 2,
            "snapshotReferenceCount": 4,
            "snapshotTaskCount": 2,
            "snapshotSetSha256": repair.EXPECTED_SNAPSHOT_SET_SHA256,
            "targetIdentitySetSha256": "b" * 64,
            "activePublishedCount": 2,
            "activePublishedOptionCount": 8,
            "activePublishedSourceCount": 2,
            "commandReceiptCount": 14,
            "commandReceiptSetSha256": "a" * 64,
        }
        for key, value in (("deletedCount", 13), ("snapshotSetSha256", "0" * 64), ("snapshotTaskCount", 3)):
            invalid = {**base, key: value}
            with self.assertRaisesRegex(ValueError, "QUESTION_DUPLICATE_REPAIR_RECEIPT_INVALID"):
                repair.parse_receipt(json.dumps(invalid), "apply")

    @patch("run_question_duplicate_repair.deploy.connect")
    @patch("run_question_duplicate_repair.deploy.run")
    def test_dry_run_uploads_and_executes_without_role_membership_changes(self, run_command, connect):
        ssh = MagicMock()
        connect.return_value = ssh
        sftp = MagicMock()
        ssh.open_sftp.return_value = sftp
        receipt = {
            "ok": True,
            "mode": "dry-run",
            "ready": True,
            "malformedActiveCount": 14,
            "canonicalActiveCount": 2,
            "snapshotReferenceCount": 4,
            "snapshotTaskCount": 2,
            "snapshotSetSha256": repair.EXPECTED_SNAPSHOT_SET_SHA256,
            "targetIdentitySetSha256": "b" * 64,
            "activePublishedCount": 16,
            "activePublishedOptionCount": 29,
            "activePublishedSourceCount": 2,
            "commandReceiptCount": 0,
            "commandReceiptSetSha256": None,
        }
        def run_side_effect(_ssh, command, **_kwargs):
            if "node '/app/question-repair-" in command:
                return (json.dumps(receipt), "")
            return ("", "")
        run_command.side_effect = run_side_effect
        with patch("run_question_duplicate_repair.operation_id", return_value="a" * 32), \
                patch("run_question_duplicate_repair.source_revision", return_value="1" * 12), \
                patch("run_question_duplicate_repair.authority_sha256", return_value="2" * 64):
            self.assertEqual(repair.run("dry-run"), receipt)
        commands = [call.args[1] for call in run_command.call_args_list]
        self.assertFalse(any("GRANT vnext_pg17_owner" in command for command in commands))
        self.assertFalse(any("REVOKE vnext_pg17_owner" in command for command in commands))
        self.assertTrue(any("EXPECTED_CLOUD_VERSION=" in command and "--apply" not in command for command in commands))
        self.assertTrue(any("EXPECTED_QUESTION_AUTHORITY_SHA256=" in command for command in commands))
        self.assertTrue(any(f"gewu-cloud-business-api:{repair.source_version()}-" in command for command in commands))
        self.assertTrue(any("rm -rf -- '/app/question-repair-" + "a" * 32 + "'" in command for command in commands))
        self.assertTrue(all("/tmp/gewu-question-duplicate-repair-" in command or "docker" in command for command in commands))
        ssh.close.assert_called_once()

    @patch("run_question_duplicate_repair.deploy.connect")
    @patch("run_question_duplicate_repair.deploy.run")
    @patch("run_question_duplicate_repair.verified_backup")
    def test_apply_returns_restore_verified_backup_receipt(self, verified_backup, run_command, connect):
        ssh = MagicMock()
        connect.return_value = ssh
        ssh.open_sftp.return_value = MagicMock()
        backup = {
            "root": "/root/scheduling-backups/postgres/20260905-010203",
            "sha256": "3" * 64,
            "restoreVerified": True,
        }
        verified_backup.return_value = backup
        receipt = {
            "ok": True,
            "mode": "apply",
            "replayed": False,
            "deletedCount": 14,
            "malformedActiveCount": 0,
            "canonicalActiveCount": 2,
            "snapshotReferenceCount": 4,
            "snapshotTaskCount": 2,
            "snapshotSetSha256": repair.EXPECTED_SNAPSHOT_SET_SHA256,
            "targetIdentitySetSha256": "b" * 64,
            "activePublishedCount": 2,
            "activePublishedOptionCount": 8,
            "activePublishedSourceCount": 2,
            "commandReceiptCount": 14,
            "commandReceiptSetSha256": "a" * 64,
        }
        def run_side_effect(_ssh, command, **_kwargs):
            if "node '/app/question-repair-" in command:
                return (json.dumps(receipt), "")
            return ("", "")
        run_command.side_effect = run_side_effect
        with patch("run_question_duplicate_repair.operation_id", return_value="c" * 32), \
                patch("run_question_duplicate_repair.source_revision", return_value="1" * 12), \
                patch("run_question_duplicate_repair.authority_sha256", return_value="2" * 64):
            self.assertEqual(repair.run("apply"), {**receipt, "backup": backup})
        verified_backup.assert_called_once_with()
        commands = [call.args[1] for call in run_command.call_args_list]
        self.assertFalse(any("GRANT " in command or "REVOKE " in command for command in commands))
        ssh.close.assert_called_once()

    @patch("run_question_duplicate_repair.deploy.connect")
    @patch("run_question_duplicate_repair.deploy.run")
    @patch("run_question_duplicate_repair.verified_backup")
    def test_apply_requires_verified_backup_and_never_grants_owner(self, verified_backup, run_command, connect):
        ssh = MagicMock()
        connect.return_value = ssh
        ssh.open_sftp.return_value = MagicMock()
        verified_backup.return_value = {
            "root": "/root/scheduling-backups/postgres/20260905-010203",
            "sha256": "3" * 64,
            "restoreVerified": True,
        }
        def run_side_effect(_ssh, command, **_kwargs):
            if "node '/app/question-repair-" in command:
                raise RuntimeError("container failed")
            return ("", "")
        run_command.side_effect = run_side_effect
        with patch("run_question_duplicate_repair.operation_id", return_value="b" * 32), \
                patch("run_question_duplicate_repair.source_revision", return_value="1" * 12), \
                patch("run_question_duplicate_repair.authority_sha256", return_value="2" * 64):
            with self.assertRaisesRegex(RuntimeError, "container failed"):
                repair.run("apply")
        commands = [call.args[1] for call in run_command.call_args_list]
        verified_backup.assert_called_once_with()
        self.assertFalse(any("GRANT " in command or "REVOKE " in command for command in commands))
        self.assertTrue(any("--apply" in command for command in commands))
        self.assertTrue(any("rm -rf -- '/app/question-repair-" + "b" * 32 + "'" in command for command in commands))
        ssh.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
