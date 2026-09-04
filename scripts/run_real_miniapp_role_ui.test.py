import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

from run_real_miniapp_role_ui import ROLE_KEYS, capture_page_screenshot, clear_test_session, is_test_account, main, parse_session_receipt, restore_session_state, run_wechatide, snapshot_session_state, user_for_session, wait_for_simulator_runtime, verify_identity, verify_pages, verify_question_bank_content


VALID_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6360000000020001e221bc330000000049454e44ae426082"
)


class RoleUiReceiptTests(unittest.TestCase):
    def test_retries_one_transient_wechatide_connection_failure(self):
        disconnected = unittest.mock.Mock(
            returncode=1,
            stdout='{"ok":false,"errorType":"CONNECT_ERROR"}',
            stderr='Failed to connect to WechatIDE.',
        )
        connected = unittest.mock.Mock(
            returncode=0,
            stdout='{"result":{"success":true,"result":{"route":"pages/index/index"}}}',
            stderr='',
        )
        with patch("run_real_miniapp_role_ui.subprocess.run", side_effect=[disconnected, connected]) as execute, patch("run_real_miniapp_role_ui.time.sleep") as sleep:
            result = run_wechatide(["automation_evaluate", "--project", "C:/miniapp", "--fn-source", "() => ({})"], retry_connect=True)
        self.assertEqual(result, {"route": "pages/index/index"})
        self.assertEqual(execute.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_does_not_retry_a_navigation_when_the_bridge_disconnects(self):
        disconnected = unittest.mock.Mock(
            returncode=1,
            stdout='{"ok":false,"errorType":"CONNECT_ERROR"}',
            stderr='Failed to connect to WechatIDE.',
        )
        with patch("run_real_miniapp_role_ui.subprocess.run", return_value=disconnected) as execute, patch("run_real_miniapp_role_ui.time.sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "CONNECT_ERROR"):
                run_wechatide(["automation_navigate", "--project", "C:/miniapp", "--action", "navigateTo", "--url", "/pages/courses/index"])
        self.assertEqual(execute.call_count, 1)
        sleep.assert_not_called()

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
        self.assertEqual(family["role"], "family_member")
        self.assertEqual(family["user_type"], "family_member")
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

    def test_polls_runtime_without_repeating_navigation_when_the_first_read_is_stale(self):
        calls = []
        routes = iter([
            {"route": "pages/courses/index", "user": "student"},
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
        self.assertEqual([call[0] for call in calls], ["automation_navigate", "automation_evaluate", "automation_evaluate"])

    def test_reports_only_sanitized_runtime_route_when_navigation_lands_elsewhere(self):
        def wechatide(arguments, **_kwargs):
            if arguments[0] == "automation_evaluate":
                return {"route": "pages/login/index", "user": "student"}
            return {"success": True}

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            with self.assertRaisesRegex(RuntimeError, r"REAL_MINIAPP_ROLE_UI_PAGE_ROUTE_INVALID:pages/login/index"):
                verify_pages(Path("C:/miniapp"), ("/pages/schedule/index",))

    def test_rejects_the_wrong_runtime_identity_even_when_the_route_matches(self):
        def wechatide(arguments, **_kwargs):
            if arguments[0] == "automation_evaluate":
                return {"route": "pages/question-bank/index", "user": "visitor"}
            return {"success": True}

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            with self.assertRaisesRegex(RuntimeError, "REAL_MINIAPP_ROLE_UI_PAGE_IDENTITY_INVALID:teacher"):
                verify_pages(Path("C:/miniapp"), ("/pages/question-bank/index",), role="teacher")

    def test_rejects_the_wrong_account_even_when_role_and_route_match(self):
        expected_account = "e2e-account-student-e2e-role-test-0123456789abcdef"

        def wechatide(arguments, **_kwargs):
            if arguments[0] == "automation_evaluate":
                return {"route": "pages/schedule/index", "user": "student", "accountId": "another-account"}
            return {"success": True}

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            with self.assertRaisesRegex(RuntimeError, "REAL_MINIAPP_ROLE_UI_PAGE_ACCOUNT_INVALID:student"):
                verify_pages(Path("C:/miniapp"), ("/pages/schedule/index",), role="student", account_id=expected_account)

    def test_question_bank_content_requires_loaded_cards_and_both_actions(self):
        counts = {
            ".question-preview-empty": 0,
            ".question-preview-item": 3,
            ".question-answer-toggle": 3,
            ".basket-toggle": 3,
        }

        def wechatide(arguments, **_kwargs):
            selector = arguments[arguments.index("--selector") + 1]
            return {"success": True, "elements": [{"elementId": str(index)} for index in range(counts[selector])]}

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            self.assertEqual(verify_question_bank_content(Path("C:/miniapp")), {
                "questionCards": 3,
                "answerActions": 3,
                "basketActions": 3,
            })

    def test_question_bank_content_rejects_a_visible_loading_or_error_state(self):
        def wechatide(arguments, **_kwargs):
            selector = arguments[arguments.index("--selector") + 1]
            return {"success": True, "elements": [{"elementId": "error"}] if selector == ".question-preview-empty" else []}

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            with self.assertRaisesRegex(RuntimeError, "REAL_MINIAPP_ROLE_UI_QUESTION_STATE_INVALID"):
                verify_question_bank_content(Path("C:/miniapp"))

    def test_question_bank_content_rejects_missing_cards_or_actions(self):
        variants = (
            {".question-preview-item": 0, ".question-answer-toggle": 0, ".basket-toggle": 0},
            {".question-preview-item": 2, ".question-answer-toggle": 1, ".basket-toggle": 2},
            {".question-preview-item": 2, ".question-answer-toggle": 2, ".basket-toggle": 1},
        )
        for counts in variants:
            def wechatide(arguments, **_kwargs):
                selector = arguments[arguments.index("--selector") + 1]
                count = counts.get(selector, 0)
                return {"success": True, "elements": [{"elementId": str(index)} for index in range(count)]}

            with self.subTest(counts=counts):
                with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
                    with self.assertRaisesRegex(RuntimeError, "REAL_MINIAPP_ROLE_UI_QUESTION_CONTENT_INVALID"):
                        verify_question_bank_content(Path("C:/miniapp"))

    def test_captures_only_a_nonempty_page_screenshot_under_the_requested_directory(self):
        def wechatide(arguments, **_kwargs):
            self.assertEqual(arguments[0], "automation_viewport_action")
            self.assertEqual(arguments[arguments.index("--action") + 1], "screenshot")
            self.assertNotIn("--wait", arguments)
            target = Path(arguments[arguments.index("--path") + 1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(VALID_PNG)
            return {"path": str(target)}

        with self.subTest("accepted"):
            with tempfile.TemporaryDirectory() as directory:
                with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
                    target = capture_page_screenshot(Path("C:/miniapp"), "teacher", "pages/courses/index", Path(directory))
                self.assertEqual(target.name, "teacher-pages-courses-index.png")
                self.assertEqual(target.read_bytes(), VALID_PNG)

    def test_accepts_a_screenshot_timeout_only_when_the_image_was_written(self):
        def wechatide(arguments, **_kwargs):
            target = Path(arguments[arguments.index("--path") + 1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(VALID_PNG)
            raise RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:timeout waiting for automator response")

        with tempfile.TemporaryDirectory() as directory:
            with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
                target = capture_page_screenshot(Path("C:/miniapp"), "teacher", "pages/courses/index", Path(directory))
            self.assertEqual(target.read_bytes(), VALID_PNG)

    def test_rejects_a_non_png_screenshot_even_when_it_is_nonempty(self):
        def wechatide(arguments, **_kwargs):
            target = Path(arguments[arguments.index("--path") + 1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"not really a png screenshot")
            return {"path": str(target)}

        with tempfile.TemporaryDirectory() as directory:
            with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
                with self.assertRaisesRegex(RuntimeError, "REAL_MINIAPP_ROLE_UI_SCREENSHOT_INVALID"):
                    capture_page_screenshot(Path("C:/miniapp"), "teacher", "pages/courses/index", Path(directory))

    def test_rejects_a_screenshot_timeout_without_an_image(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_FAILED:timeout waiting for automator response")):
                with self.assertRaisesRegex(RuntimeError, "timeout waiting for automator response"):
                    capture_page_screenshot(Path("C:/miniapp"), "teacher", "pages/courses/index", Path(directory))

    def test_identity_injection_restarts_the_runtime_after_session_storage_is_prepared(self):
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
            "simulator_refresh", "--project", str(Path("C:/miniapp")),
        ], wechatide_calls)
        self.assertFalse(any(call_args[0] == "automation_navigate" for call_args in wechatide_calls))
        self.assertEqual(identity["role"], "student")

    def test_identity_injection_marks_cleanup_as_required_after_the_first_token_write(self):
        account_id = "e2e-account-student-e2e-role-test-0123456789abcdef"
        marked = []

        def wx_api(_project, method, args):
            if method == "setStorageSync" and args[0] == "user_info":
                raise RuntimeError("injection interrupted")

        session = {"accountId": account_id, "token": "ticket.signature"}
        with patch("run_real_miniapp_role_ui.run_wx_api", side_effect=wx_api):
            with self.assertRaisesRegex(RuntimeError, "injection interrupted"):
                verify_identity(Path("C:/miniapp"), session, on_session_injected=lambda: marked.append(True))
        self.assertEqual(marked, [True])

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
        cleanup_sources = []

        def wechatide(arguments, **_kwargs):
            if arguments[0] == "automation_evaluate" and "removeStorageSync" in arguments[-1]:
                cleanup_sources.append(arguments[-1])
                return True
            result = next(reads)
            if isinstance(result, Exception):
                raise result
            return result

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide), patch("run_real_miniapp_role_ui.time.sleep") as sleep:
            self.assertTrue(clear_test_session(Path("C:/miniapp")))
        sleep.assert_called_once_with(1)
        self.assertEqual(len(cleanup_sources), 1)
        self.assertIn("auth_token", cleanup_sources[0])
        self.assertIn("auth_session_state_v1", cleanup_sources[0])
        self.assertIn("e2e-account-", cleanup_sources[0])

    def test_forced_cleanup_removes_injected_auth_even_when_user_info_was_cleared(self):
        cleanup_sources = []

        def wechatide(arguments, **_kwargs):
            source = arguments[arguments.index("--fn-source") + 1]
            cleanup_sources.append(source)
            return True

        with patch("run_real_miniapp_role_ui.run_wechatide", side_effect=wechatide):
            self.assertTrue(clear_test_session(Path("C:/miniapp"), force=True))
        self.assertEqual(len(cleanup_sources), 1)
        self.assertIn("getStorageInfoSync", cleanup_sources[0])
        self.assertNotIn("if (!user", cleanup_sources[0])

    def test_snapshots_and_restores_a_preexisting_real_session_without_logging_it(self):
        prior = {
            "auth_token": "private-real-token",
            "user_info": {"id": "real-account", "user_type": "teacher"},
            "auth_session_generation": 7,
        }
        with patch("run_real_miniapp_role_ui.run_wechatide", return_value=prior):
            snapshot = snapshot_session_state(Path("C:/miniapp"))
        self.assertEqual(snapshot, prior)

        calls = []
        with patch("run_real_miniapp_role_ui.run_wx_api", side_effect=lambda _project, method, args: calls.append((method, args))):
            restore_session_state(Path("C:/miniapp"), snapshot)
        restored = [args for method, args in calls if method == "setStorageSync"]
        self.assertIn(["auth_token", "private-real-token"], restored)
        self.assertIn(["user_info", {"id": "real-account", "user_type": "teacher"}], restored)
        self.assertIn(["auth_session_generation", 7], restored)

    def test_main_restores_a_real_session_even_when_forced_test_cleanup_fails(self):
        prior = {"auth_token": "private-real-token", "user_info": {"id": "real-account", "user_type": "teacher"}}
        marker = "e2e-role-test-0123456789abcdef"
        receipt = {
            "marker": marker,
            "sessions": {"visitor": {"accountId": f"e2e-account-visitor-{marker}", "token": "ticket.signature"}},
        }

        def inject(_project, _session, on_session_injected=None):
            on_session_injected()
            return {"role": "visitor"}

        with tempfile.TemporaryDirectory() as directory:
            with patch("run_real_miniapp_role_ui.snapshot_session_state", return_value=prior), \
                    patch("run_real_miniapp_role_ui.fetch_sessions", return_value=receipt), \
                    patch("run_real_miniapp_role_ui.verify_identity", side_effect=inject), \
                    patch("run_real_miniapp_role_ui.clear_test_session", side_effect=RuntimeError("cleanup failed")), \
                    patch("run_real_miniapp_role_ui.restore_session_state") as restore:
                with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
                    main(["--project", directory, "--role", "visitor"])
        restore.assert_called_once_with(Path(directory).resolve(), prior)


if __name__ == "__main__":
    unittest.main()
