import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

from run_real_miniapp_role_ui import ROLE_KEYS, capture_page_screenshot, clear_test_session, is_test_account, parse_session_receipt, user_for_session, wait_for_simulator_runtime, verify_identity, verify_pages


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

    def test_waits_for_the_simulator_runtime_after_a_refresh(self):
        states = iter([{"ready": False}, {"ready": True}])

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=lambda *_args, **_kwargs: next(states)), patch("run_real_miniapp_role_ui.time.sleep") as sleep:
            wait_for_simulator_runtime(Path("C:/miniapp"), attempts=2, pause_seconds=1)
        sleep.assert_called_once_with(1)

    def test_rejects_a_simulator_that_never_becomes_ready(self):
        with patch("run_real_miniapp_role_ui.run_wechatide", return_value={"ready": False}), patch("run_real_miniapp_role_ui.time.sleep"):
            with self.assertRaisesRegex(RuntimeError, "REAL_MINIAPP_ROLE_UI_RUNTIME_UNAVAILABLE"):
                wait_for_simulator_runtime(Path("C:/miniapp"), attempts=2, pause_seconds=1)

    def test_retries_a_known_automator_timeout_while_waiting_for_runtime(self):
        results = iter([RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:timeout waiting for automator response"), {"ready": True}])

        def wechatide(*_args, **_kwargs):
            result = next(results)
            if isinstance(result, Exception):
                raise result
            return result

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide), patch("run_real_miniapp_role_ui.time.sleep") as sleep:
            wait_for_simulator_runtime(Path("C:/miniapp"), attempts=2, pause_seconds=1)
        sleep.assert_called_once_with(1)

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

    def test_reports_only_sanitized_runtime_route_when_navigation_lands_elsewhere(self):
        def wechatide(arguments, **_kwargs):
            if arguments[0] == "automation_evaluate":
                return {"route": "pages/login/index", "user": "student"}
            return {"success": True}

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            with self.assertRaisesRegex(RuntimeError, r"REAL_MINIAPP_ROLE_UI_PAGE_ROUTE_INVALID:pages/login/index"):
                verify_pages(Path("C:/miniapp"), ("/pages/schedule/index",))

    def test_captures_only_a_nonempty_page_screenshot_under_the_requested_directory(self):
        def wechatide(arguments, **_kwargs):
            self.assertEqual(arguments[0], "simulator_screenshot")
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

    def test_accepts_a_screenshot_timeout_only_when_the_image_was_written(self):
        def wechatide(arguments, **_kwargs):
            target = Path(arguments[arguments.index("--path") + 1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"PNG evidence")
            raise RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:timeout waiting for automator response")

        with tempfile.TemporaryDirectory() as directory:
            with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
                target = capture_page_screenshot(Path("C:/miniapp"), "teacher", "pages/courses/index", Path(directory))
            self.assertEqual(target.read_bytes(), b"PNG evidence")

    def test_rejects_a_screenshot_timeout_without_an_image(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:timeout waiting for automator response")):
                with self.assertRaisesRegex(RuntimeError, "timeout waiting for automator response"):
                    capture_page_screenshot(Path("C:/miniapp"), "teacher", "pages/courses/index", Path(directory))

    def test_identity_injection_waits_for_the_runtime_after_one_simulator_refresh(self):
        account_id = "e2e-account-student-e2e-role-test-0123456789abcdef"
        storage_calls = []
        wechatide_calls = []

        def wx_api(_project, method, args):
            storage_calls.append((method, args))

        def wechatide(arguments, **_kwargs):
            wechatide_calls.append(arguments)
            if arguments[0] == "automation_evaluate":
                if "ready:" in arguments[arguments.index("--fn-source") + 1]:
                    return {"ready": True}
                return {"accountId": account_id, "role": "student", "identityKind": None, "accountState": "formal"}
            return {"success": True}

        session = {"accountId": account_id, "token": "ticket.signature"}
        with patch("run_real_miniapp_role_ui.run_wx_api", side_effect=wx_api), patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            identity = verify_identity(Path("C:/miniapp"), session)
        session_state_writes = [args for method, args in storage_calls if method == "setStorageSync" and args[0] == "auth_session_state_v1"]
        generation_writes = [args for method, args in storage_calls if method == "setStorageSync" and args[0] == "auth_session_generation"]
        self.assertEqual(generation_writes, [["auth_session_generation", 0]])
        self.assertEqual(session_state_writes, [["auth_session_state_v1", {"version": 1, "generation": 0, "invalidated": False}]])
        self.assertIn([
            "automation_navigate", "--project", str(Path("C:/miniapp")),
            "--action", "reLaunch", "--url", "/pages/index/index", "--wait", "1",
        ], wechatide_calls)
        self.assertEqual(identity["role"], "student")

    def test_identity_read_retries_only_the_post_refresh_automator_timeout(self):
        account_id = "e2e-account-student-e2e-role-test-0123456789abcdef"
        identity_reads = iter([
            RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:timeout waiting for automator response"),
            {"accountId": account_id, "role": "student", "identityKind": None, "accountState": "formal"},
        ])

        def wechatide(arguments, **_kwargs):
            if arguments[0] != "automation_evaluate":
                return {"success": True}
            source = arguments[arguments.index("--fn-source") + 1]
            if "ready:" in source:
                return {"ready": True}
            result = next(identity_reads)
            if isinstance(result, Exception):
                raise result
            return result

        session = {"accountId": account_id, "token": "ticket.signature"}
        with patch("run_real_miniapp_role_ui.run_wx_api"), patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide), patch("run_real_miniapp_role_ui.time.sleep") as sleep:
            identity = verify_identity(Path("C:/miniapp"), session)
        self.assertEqual(identity["accountId"], account_id)
        self.assertEqual(sleep.call_args_list, [call(1), call(1)])

    def test_identity_read_retries_when_wx_is_temporarily_unavailable_after_refresh(self):
        account_id = "e2e-account-student-e2e-role-test-0123456789abcdef"
        identity_reads = iter([
            RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:wx is not defined"),
            {"accountId": account_id, "role": "student", "identityKind": None, "accountState": "formal"},
        ])

        def wechatide(arguments, **_kwargs):
            if arguments[0] != "automation_evaluate":
                return {"success": True}
            source = arguments[arguments.index("--fn-source") + 1]
            if "ready:" in source:
                return {"ready": True}
            result = next(identity_reads)
            if isinstance(result, Exception):
                raise result
            return result

        session = {"accountId": account_id, "token": "ticket.signature"}
        with patch("run_real_miniapp_role_ui.run_wx_api"), patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide), patch("run_real_miniapp_role_ui.time.sleep") as sleep:
            identity = verify_identity(Path("C:/miniapp"), session)
        self.assertEqual(identity["accountId"], account_id)
        self.assertEqual(sleep.call_args_list, [call(1), call(1)])

    def test_cleanup_retries_a_transient_wx_unavailable_error_then_removes_only_e2e_keys(self):
        account_id = "e2e-account-visitor-e2e-role-test-0123456789abcdef"
        reads = iter([
            RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:wx is not defined"),
            {"id": account_id},
        ])
        removed = []

        def wechatide(_arguments, **_kwargs):
            result = next(reads)
            if isinstance(result, Exception):
                raise result
            return result

        def wx_api(_project, method, args):
            removed.append((method, args[0]))

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide), patch("run_real_miniapp_role_ui.run_wx_api", side_effect=wx_api), patch("run_real_miniapp_role_ui.time.sleep") as sleep:
            self.assertTrue(clear_test_session(Path("C:/miniapp")))
        sleep.assert_called_once_with(1)
        self.assertEqual([key for _method, key in removed], ["auth_token", "user_info", "user_permissions", "auth_session_generation", "auth_session_state_v1"])


if __name__ == "__main__":
    unittest.main()
