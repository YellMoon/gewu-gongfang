import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from run_real_miniapp_role_ui import ROLE_KEYS, capture_page_screenshot, is_test_account, parse_session_receipt, user_for_session, verify_identity, verify_pages


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
        self.assertEqual(calls[0][-2:], ["--wait", "2"])

    def test_rejects_non_timeout_navigation_failures(self):
        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:project closed")):
            with self.assertRaisesRegex(RuntimeError, "project closed"):
                verify_pages(Path("C:/miniapp"), ("/pages/courses/index",))

    def test_retries_once_only_when_the_refreshed_runtime_is_observably_back_on_home(self):
        calls = []
        routes = iter([
            {"route": "pages/index/index", "user": "student"},
            {"route": "pages/schedule/index", "user": "student"},
        ])

        def wechatide(arguments, **_kwargs):
            calls.append(arguments)
            if arguments[0] == "automation_evaluate":
                return next(routes)
            return {"success": True}

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            visited = verify_pages(Path("C:/miniapp"), ("/pages/schedule/index",))
        self.assertEqual(visited, [{"route": "pages/schedule/index", "user": "student"}])
        self.assertEqual([call[0] for call in calls], ["automation_navigate", "automation_evaluate", "automation_navigate", "automation_evaluate"])

    def test_captures_only_a_nonempty_page_screenshot_under_the_requested_directory(self):
        def wechatide(arguments, **_kwargs):
            self.assertEqual(arguments[0], "automation_viewport_action")
            self.assertEqual(arguments[arguments.index("--action") + 1], "screenshot")
            self.assertEqual(arguments[arguments.index("--wait") + 1], "4")
            target = Path(arguments[arguments.index("--path") + 1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"PNG evidence")
            return {"path": str(target)}

        with self.subTest("accepted"):
            with tempfile.TemporaryDirectory() as directory:
                with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
                    target = capture_page_screenshot(Path("C:/miniapp"), "teacher", "pages/courses/index", Path(directory))
                self.assertEqual(target.name, "teacher-pages-courses-index.png")
                self.assertEqual(target.read_bytes(), b"PNG evidence")

    def test_identity_injection_resets_the_real_auth_session_state_before_one_simulator_refresh(self):
        account_id = "e2e-account-student-e2e-role-test-0123456789abcdef"
        storage_calls = []
        wechatide_calls = []

        def wx_api(_project, method, args):
            storage_calls.append((method, args))

        def wechatide(arguments, **_kwargs):
            wechatide_calls.append(arguments)
            if arguments[0] == "automation_evaluate":
                return {"accountId": account_id, "role": "student", "identityKind": None, "accountState": "formal"}
            return {"success": True}

        session = {"accountId": account_id, "token": "ticket.signature"}
        with patch("run_real_miniapp_role_ui.run_wx_api", side_effect=wx_api), patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            identity = verify_identity(Path("C:/miniapp"), session)
        removed_keys = [args[0] for method, args in storage_calls if method == "removeStorageSync"]
        self.assertIn("auth_session_generation", removed_keys)
        self.assertIn("auth_session_state_v1", removed_keys)
        self.assertIn(["simulator_refresh", "--project", str(Path("C:/miniapp"))], wechatide_calls)
        self.assertEqual(identity["role"], "student")


if __name__ == "__main__":
    unittest.main()
