import json
import unittest
from pathlib import Path
from unittest.mock import patch

from run_real_miniapp_role_ui import ROLE_KEYS, is_test_account, parse_session_receipt, user_for_session, verify_pages


class RoleUiReceiptTests(unittest.TestCase):
    def test_accepts_complete_short_lived_session_receipt(self):
        marker = "e2e-role-test-0123456789abcdef"
        sessions = {
            key: {"accountId": f"e2e-account-{key}-{marker}", "token": "ticket.signature"}
            for key in ROLE_KEYS
        }
        receipt = parse_session_receipt(json.dumps({"ok": True, "marker": marker, "sessions": sessions}))
        self.assertEqual(set(receipt["sessions"]), set(ROLE_KEYS))

    def test_rejects_missing_or_mixed_role_accounts(self):
        marker = "e2e-role-test-0123456789abcdef"
        incomplete = {"ok": True, "marker": marker, "sessions": {"visitor": {"accountId": f"e2e-account-visitor-{marker}", "token": "ticket.signature"}}}
        with self.assertRaises(ValueError):
            parse_session_receipt(json.dumps(incomplete))
        mixed = {
            "ok": True, "marker": marker,
            "sessions": {key: {"accountId": f"e2e-account-{key}-{marker}", "token": "ticket.signature"} for key in ROLE_KEYS},
        }
        mixed["sessions"]["teacher"]["accountId"] = "e2e-account-teacher-e2e-role-test-abcdef0123456789"
        with self.assertRaises(ValueError):
            parse_session_receipt(json.dumps(mixed))

    def test_derives_only_the_existing_e2e_profile_ids(self):
        marker = "e2e-role-test-0123456789abcdef"
        teacher = user_for_session("teacher", f"e2e-account-teacher-{marker}")
        family = user_for_session("family", f"e2e-account-family-{marker}")
        self.assertEqual(teacher["teacher_id"], f"e2e-teacher-{marker}")
        self.assertEqual(family["student_id"], f"e2e-student-{marker}")
        self.assertEqual(family["identity_kind"], "family_member")
        self.assertTrue(is_test_account(family["id"]))
        self.assertFalse(is_test_account("real-user-account"))

    def test_accepts_an_automator_timeout_only_after_the_runtime_confirms_route(self):
        calls = []

        def wechatide(arguments, **_kwargs):
            calls.append(arguments)
            if arguments[0] == "automation_navigate":
                raise RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:timeout waiting for automator response")
            return {"route": "pages/courses/index", "user": "teacher"}

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            visited = verify_pages(Path("C:/miniapp"), ("/pages/courses/index",))
        self.assertEqual(visited, [{"route": "pages/courses/index", "user": "teacher"}])
        self.assertEqual([call[0] for call in calls], ["automation_navigate", "automation_evaluate"])

    def test_rejects_non_timeout_navigation_failures(self):
        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:project closed")):
            with self.assertRaisesRegex(RuntimeError, "project closed"):
                verify_pages(Path("C:/miniapp"), ("/pages/courses/index",))


if __name__ == "__main__":
    unittest.main()
