import unittest

from run_real_test_identities import parse_receipt


class TestIdentityReceipt(unittest.TestCase):
    def test_accepts_complete_role_fixture(self):
        receipt = parse_receipt('''{"ok":true,"marker":"e2e-role-test-0123456789ab","identities":{"visitor":{"accountId":"e2e-account-visitor-e2e-role-test-0123456789ab","roles":[],"profileId":null,"relationship":null},"teacher":{"accountId":"e2e-account-teacher-e2e-role-test-0123456789ab","roles":["teacher"],"profileId":"teacher","relationship":null},"student":{"accountId":"e2e-account-student-e2e-role-test-0123456789ab","roles":["student"],"profileId":"student","relationship":"student"},"family":{"accountId":"e2e-account-family-e2e-role-test-0123456789ab","roles":["student"],"profileId":"student","relationship":"guardian"}}}''')
        self.assertTrue(receipt["ok"])

    def test_rejects_incomplete_fixture(self):
        with self.assertRaises(ValueError):
            parse_receipt('{"ok":true,"marker":"e2e-role-test-0123456789ab","identities":{}}')


if __name__ == "__main__":
    unittest.main()
