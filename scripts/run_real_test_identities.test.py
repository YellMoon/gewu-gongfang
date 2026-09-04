import subprocess
import unittest

from run_real_test_identities import native_failure, native_ssh_command, parse_receipt


class TestIdentityReceipt(unittest.TestCase):
    def test_accepts_complete_role_fixture(self):
        receipt = parse_receipt('''{"ok":true,"marker":"e2e-role-test-0123456789ab","identities":{"visitor":{"accountId":"e2e-account-visitor-e2e-role-test-0123456789ab","roles":[],"profileId":null,"relationship":null},"teacher":{"accountId":"e2e-account-teacher-e2e-role-test-0123456789ab","roles":["teacher"],"profileId":"teacher","relationship":null},"student":{"accountId":"e2e-account-student-e2e-role-test-0123456789ab","roles":["student"],"profileId":"student","relationship":"student"},"family":{"accountId":"e2e-account-family-e2e-role-test-0123456789ab","roles":["family_member"],"profileId":"student","relationship":"guardian"}}}''')
        self.assertTrue(receipt["ok"])

    def test_rejects_incomplete_fixture(self):
        with self.assertRaises(ValueError):
            parse_receipt('{"ok":true,"marker":"e2e-role-test-0123456789ab","identities":{}}')

    def test_native_ssh_command_requires_host_key_check_and_private_key(self):
        command = native_ssh_command(
            host="example.test", port=2222, user="root", key_path="C:/keys/test", known_hosts="C:/keys/known_hosts", remote_command="true"
        )
        self.assertEqual(command[:4], ["ssh", "-p", "2222", "-o"])
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertIn("UserKnownHostsFile=C:/keys/known_hosts", command)
        self.assertIn("C:/keys/test", command)
        self.assertEqual(command[-2:], ["root@example.test", "true"])

    def test_native_failure_keeps_a_bounded_transport_detail(self):
        error = native_failure("REAL_TEST_IDENTITY_NATIVE_COPY_FAILED", subprocess.CompletedProcess([], 1, "", "connection refused\n"))
        self.assertEqual(str(error), "REAL_TEST_IDENTITY_NATIVE_COPY_FAILED:connection refused")


if __name__ == "__main__":
    unittest.main()
