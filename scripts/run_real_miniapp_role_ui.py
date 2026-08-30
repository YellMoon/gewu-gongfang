#!/usr/bin/env python3
"""Run real-cloud miniapp role checks with short-lived, non-personal E2E sessions."""

import argparse
import json
import re
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy  # noqa: E402

PROJECT = ROOT / "miniapp"
CONTAINER = "gewu-cloud-business-api"
ROLE_KEYS = ("visitor", "teacher", "student", "family")
SESSION_HELPER = ROOT / "scripts" / "real-miniapp-role-session.js"
CLOUD_HELPER = ROOT / "scripts" / "real-cloud-business-acceptance.js"
WECHATIDE = r"C:\Program Files (x86)\Tencent\微信web开发者工具\wechatide.cmd"
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
ACCOUNT_PATTERN = re.compile(r"^e2e-account-(visitor|teacher|student|family)-e2e-role-test-[a-z0-9-]{12,64}$")
AUTH_SESSION_GENERATION_KEY = "auth_session_generation"
AUTH_SESSION_STATE_KEY = "auth_session_state_v1"

ROLE_PAGES = {
    "visitor": ("/pages/question-bank/index", "/pages/schedule/index"),
    "teacher": ("/pages/courses/index", "/pages/schedule/index", "/pages/question-bank/index"),
    "student": ("/pages/schedule/index", "/pages/question-bank/index"),
    "family": ("/pages/schedule/index", "/pages/question-bank/index"),
}


def parse_session_receipt(output):
    try:
        payload = json.loads([line.strip() for line in str(output).splitlines() if line.strip()][-1])
        sessions = payload["sessions"]
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("REAL_MINIAPP_ROLE_SESSION_RECEIPT_INVALID") from error
    if not isinstance(payload, dict) or payload.get("ok") is not True or not isinstance(payload.get("marker"), str) or not isinstance(sessions, dict) or set(sessions) != set(ROLE_KEYS):
        raise ValueError("REAL_MINIAPP_ROLE_SESSION_RECEIPT_INVALID")
    for key in ROLE_KEYS:
        session = sessions[key]
        if not isinstance(session, dict) or not isinstance(session.get("accountId"), str) or not ACCOUNT_PATTERN.fullmatch(session["accountId"]) or not isinstance(session.get("token"), str) or not TOKEN_PATTERN.fullmatch(session["token"]):
            raise ValueError("REAL_MINIAPP_ROLE_SESSION_RECEIPT_INVALID")
    markers = {session["accountId"].split(f"e2e-account-{key}-", 1)[1] for key, session in sessions.items()}
    if len(markers) != 1 or payload["marker"] not in markers:
        raise ValueError("REAL_MINIAPP_ROLE_SESSION_RECEIPT_INVALID")
    return payload


def run_wechatide(arguments, *, timeout=60):
    result = subprocess.run(["cmd.exe", "/d", "/c", "call", WECHATIDE, "-c", "Codex", *arguments], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        detail = (result.stderr + " " + result.stdout).strip().replace("\n", " ")[-1000:]
        raise RuntimeError(f"REAL_MINIAPP_ROLE_UI_TOOL_FAILED:{detail}" if detail else "REAL_MINIAPP_ROLE_UI_TOOL_FAILED")
    try:
        value = json.loads(result.stdout).get("result", {})
        while isinstance(value, dict) and "result" in value:
            value = value["result"]
        return value
    except (AttributeError, json.JSONDecodeError) as error:
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_TOOL_RECEIPT_INVALID") from error


def run_wx_api(project, method, args):
    if not isinstance(args, list):
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_WX_ARGS_INVALID")
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json", delete=False) as handle:
            json.dump(args, handle, ensure_ascii=True, separators=(",", ":"))
            temp_path = handle.name
        return run_wechatide(["automation_wx_api", "--project", str(project), "--action", "call", "--method", method, "--args-file", temp_path])
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)


def user_for_session(key, account_id):
    marker = account_id.split(f"e2e-account-{key}-", 1)[1]
    if key == "visitor":
        return {"id": account_id, "cloud_account_id": account_id, "role": "visitor", "user_type": "visitor", "identity_kind": "visitor", "account_state": "visitor", "token_use": "miniapp-visitor", "authority_id": f"cloud:{account_id}", "capabilities": ["projection:read", "role-application:read", "role-application:submit", "question-preview:read"]}
    if key == "teacher":
        return {"id": account_id, "cloud_account_id": account_id, "role": "teacher", "user_type": "teacher", "account_state": "formal", "token_use": "miniapp-cloud", "teacher_id": f"e2e-teacher-{marker}"}
    user = {"id": account_id, "cloud_account_id": account_id, "role": "student", "user_type": "student", "account_state": "formal", "token_use": "miniapp-cloud", "student_id": f"e2e-student-{marker}", "linked_student_ids": [f"e2e-student-{marker}"]}
    if key == "family":
        user.update({"identity_kind": "family_member", "student_relationship": "guardian"})
    return user


def is_test_account(value):
    return isinstance(value, str) and ACCOUNT_PATTERN.fullmatch(value) is not None


def clear_test_session(project):
    current = read_refreshed_test_user(project)
    if not isinstance(current, dict) or not is_test_account(current.get("id")):
        return False
    cleanup = (
        "() => { const user = wx.getStorageSync('user_info'); "
        "if (!user || typeof user.id !== 'string' || !/^e2e-account-(visitor|teacher|student|family)-e2e-role-test-[a-z0-9-]{12,64}$/.test(user.id)) return false; "
        "['auth_token','user_info','user_permissions','auth_session_generation','auth_session_state_v1'].forEach(key => wx.removeStorageSync(key)); return true; }"
    )
    result = run_wechatide(["automation_evaluate", "--project", str(project), "--fn-source", cleanup])
    if result is not True:
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_TEST_SESSION_CLEANUP_FAILED")
    return True


def wait_for_simulator_runtime(project, *, attempts=4, pause_seconds=1):
    if not isinstance(attempts, int) or attempts < 1 or not isinstance(pause_seconds, (int, float)) or pause_seconds < 0:
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_RUNTIME_INPUT_INVALID")
    for attempt in range(attempts):
        try:
            runtime = run_wechatide([
                "automation_evaluate", "--project", str(project),
                "--fn-source", "() => ({ ready: typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' })",
            ])
        except RuntimeError as error:
            if "timeout waiting for automator response" not in str(error):
                raise
            runtime = None
        if isinstance(runtime, dict) and runtime.get("ready") is True:
            return
        if attempt + 1 < attempts:
            time.sleep(pause_seconds)
    raise RuntimeError("REAL_MINIAPP_ROLE_UI_RUNTIME_UNAVAILABLE")


def is_transient_post_refresh_automator_error(error):
    message = str(error)
    return "timeout waiting for automator response" in message or "wx is not defined" in message


def read_refreshed_test_user(project, *, attempts=3, pause_seconds=1):
    if not isinstance(attempts, int) or attempts < 1 or not isinstance(pause_seconds, (int, float)) or pause_seconds < 0:
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_TEST_USER_READ_INPUT_INVALID")
    command = ["automation_evaluate", "--project", str(project), "--fn-source", "() => wx.getStorageSync('user_info') || null"]
    last_transient_error = None
    for attempt in range(attempts):
        try:
            return run_wechatide(command)
        except RuntimeError as error:
            if not is_transient_post_refresh_automator_error(error):
                raise
            last_transient_error = error
            if attempt + 1 < attempts:
                time.sleep(pause_seconds)
    raise last_transient_error


def read_refreshed_identity(project, *, attempts=3, pause_seconds=1):
    if not isinstance(attempts, int) or attempts < 1 or not isinstance(pause_seconds, (int, float)) or pause_seconds < 0:
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_IDENTITY_READ_INPUT_INVALID")
    command = [
        "automation_evaluate", "--project", str(project),
        "--fn-source", "() => { const user = wx.getStorageSync('user_info'); return { accountId: user && user.id, role: user && user.role, identityKind: user && user.identity_kind || null, accountState: user && user.account_state }; }",
    ]
    last_transient_error = None
    for attempt in range(attempts):
        try:
            return run_wechatide(command)
        except RuntimeError as error:
            if not is_transient_post_refresh_automator_error(error):
                raise
            last_transient_error = error
            if attempt + 1 < attempts:
                time.sleep(pause_seconds)
    raise last_transient_error


def verify_identity(project, session):
    key = ACCOUNT_PATTERN.fullmatch(session["accountId"]).group(1)
    user = user_for_session(key, session["accountId"])
    run_wx_api(project, "setStorageSync", ["auth_token", session["token"]])
    run_wx_api(project, "setStorageSync", ["user_info", user])
    run_wx_api(project, "removeStorageSync", ["user_permissions"])
    # This is an authenticated cloud test session, not a raw storage spoof.
    # Mirror the normal login committer so startup can recognize the session as
    # intentionally activated while authorization is refreshed from the cloud.
    run_wx_api(project, "setStorageSync", [AUTH_SESSION_GENERATION_KEY, 0])
    run_wx_api(project, "setStorageSync", [AUTH_SESSION_STATE_KEY, {"version": 1, "generation": 0, "invalidated": False}])
    # Re-launch from the injected authenticated storage rather than refreshing
    # DevTools' whole simulator. Whole-simulator refresh can retain a stale
    # unauthenticated launch fallback and race it against the first role page.
    run_wechatide([
        "automation_navigate", "--project", str(project),
        "--action", "reLaunch", "--url", "/pages/index/index", "--wait", "1",
    ], timeout=60)
    wait_for_simulator_runtime(project)
    result = read_refreshed_identity(project)
    if not isinstance(result, dict) or result.get("accountId") != session["accountId"] or result.get("role") != user["role"]:
        raise RuntimeError(f"REAL_MINIAPP_ROLE_UI_INJECTION_INVALID:{json.dumps(result, ensure_ascii=True)[:500]}")
    # DevTools reports the JavaScript bridge as ready before the launch-time
    # authentication initializer has finished. Let that prior initializer
    # settle before driving a tab change; otherwise its stale login fallback
    # can win a race with the first requested role page.
    time.sleep(1)
    return {key: result.get(key) for key in ("accountId", "role", "identityKind", "accountState")}


def capture_page_screenshot(project, role, route, screenshots_dir):
    if role not in ROLE_KEYS or not isinstance(route, str) or not route or not isinstance(screenshots_dir, Path):
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_SCREENSHOT_INPUT_INVALID")
    filename = f"{role}-{route.strip('/').replace('/', '-')}.png"
    target = screenshots_dir.resolve() / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        run_wechatide([
            "simulator_screenshot", "--project", str(project), "--wait", "4", "--path", str(target),
        ])
    except RuntimeError as error:
        if "timeout waiting for automator response" not in str(error) or not target.is_file() or target.stat().st_size < 8:
            raise
    if not target.is_file() or target.stat().st_size < 8:
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_SCREENSHOT_MISSING")
    return target


def verify_pages(project, pages, *, role=None, screenshots_dir=None):
    visited = []
    for page in pages:
        action = "switchTab" if page in {"/pages/schedule/index", "/pages/question-bank/index"} else "navigateTo"
        expected_route = page.removeprefix("/")
        navigation = ["automation_navigate", "--project", str(project), "--action", action, "--url", page, "--wait", "2"]
        try:
            run_wechatide(navigation, timeout=45)
        except RuntimeError as error:
            # DevTools can report an automator timeout after the navigation has
            # completed. Treat it as successful only when the runtime reports
            # the exact requested route; all other navigation failures remain
            # hard failures.
            if "timeout waiting for automator response" not in str(error):
                raise
        runtime = run_wechatide(["automation_evaluate", "--project", str(project), "--fn-source", "() => ({ route: getCurrentPages().slice(-1)[0]?.route || null, user: wx.getStorageSync('user_info')?.user_type || null })"])
        if isinstance(runtime, dict) and runtime.get("route") == "pages/index/index":
            run_wechatide(navigation, timeout=45)
            runtime = run_wechatide(["automation_evaluate", "--project", str(project), "--fn-source", "() => ({ route: getCurrentPages().slice(-1)[0]?.route || null, user: wx.getStorageSync('user_info')?.user_type || null })"])
        if not isinstance(runtime, dict) or runtime.get("route") != expected_route:
            # Keep this receipt useful for real-runtime diagnosis without ever
            # serialising session data, account IDs, or any user profile fields.
            route = runtime.get("route") if isinstance(runtime, dict) else None
            safe_route = route if isinstance(route, str) and re.fullmatch(r"[a-z0-9_/-]+", route) else "unknown"
            raise RuntimeError(f"REAL_MINIAPP_ROLE_UI_PAGE_ROUTE_INVALID:{safe_route}")
        if screenshots_dir is not None:
            if role not in ROLE_KEYS:
                raise RuntimeError("REAL_MINIAPP_ROLE_UI_SCREENSHOT_INPUT_INVALID")
            runtime["screenshot"] = capture_page_screenshot(project, role, expected_route, screenshots_dir).name
        visited.append(runtime)
    return visited


def fetch_sessions():
    if not SESSION_HELPER.is_file() or not CLOUD_HELPER.is_file():
        raise RuntimeError("REAL_MINIAPP_ROLE_SESSION_HELPER_MISSING")
    nonce = secrets.token_hex(12)
    remote_dir = f"/tmp/gewu-real-miniapp-role-session-{nonce}"
    container_dir = f"/app/.gewu-real-miniapp-role-session-{nonce}"
    session_path = f"{remote_dir}/sessions.json"
    ssh = deploy.connect()
    staged = False
    try:
        deploy.run(ssh, f"mkdir -p '{remote_dir}'")
        staged = True
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(SESSION_HELPER), f"{remote_dir}/real-miniapp-role-session.js")
            sftp.put(str(CLOUD_HELPER), f"{remote_dir}/real-cloud-business-acceptance.js")
        finally:
            sftp.close()
        deploy.run(ssh, f"docker exec -u 0 {CONTAINER} mkdir -p '{container_dir}'")
        deploy.run(ssh, f"docker exec -u 0 {CONTAINER} mkdir -p '{remote_dir}'")
        deploy.run(ssh, f"docker cp '{remote_dir}/real-miniapp-role-session.js' {CONTAINER}:{container_dir}/real-miniapp-role-session.js")
        deploy.run(ssh, f"docker cp '{remote_dir}/real-cloud-business-acceptance.js' {CONTAINER}:{container_dir}/real-cloud-business-acceptance.js")
        output, _ = deploy.run(ssh, f"docker exec -u 0 -e GEWU_REAL_MINIAPP_ROLE_SESSION_OUTPUT_PATH='{session_path}' {CONTAINER} node '{container_dir}/real-miniapp-role-session.js'", timeout=90)
        safe_receipt = json.loads([line.strip() for line in str(output).splitlines() if line.strip()][-1])
        if safe_receipt.get("ok") is not True or set(safe_receipt.get("sessionKeys", [])) != set(ROLE_KEYS):
            raise RuntimeError("REAL_MINIAPP_ROLE_SESSION_SAFE_RECEIPT_INVALID")
        deploy.run(ssh, f"docker cp {CONTAINER}:{session_path} '{session_path}'")
        sftp = ssh.open_sftp()
        try:
            with sftp.open(session_path, "r") as source:
                secret_receipt = source.read().decode("utf-8")
        finally:
            sftp.close()
        return parse_session_receipt(secret_receipt)
    finally:
        if staged:
            deploy.run(ssh, f"docker exec -u 0 {CONTAINER} rm -rf -- '{container_dir}' '{session_path}'; rm -rf -- '{remote_dir}'")
        ssh.close()


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default=str(PROJECT))
    parser.add_argument("--pages", action="store_true")
    parser.add_argument("--role", choices=ROLE_KEYS)
    parser.add_argument("--screenshots-dir")
    args = parser.parse_args(argv)
    project = Path(args.project).resolve()
    if not project.is_dir():
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_PROJECT_MISSING")
    screenshots_dir = Path(args.screenshots_dir).resolve() if args.screenshots_dir else None
    receipt = fetch_sessions()
    checks = {}
    keys = (args.role,) if args.role else ROLE_KEYS
    try:
        for key in keys:
            identity = verify_identity(project, receipt["sessions"][key])
            pages = verify_pages(project, ROLE_PAGES[key], role=key, screenshots_dir=screenshots_dir) if args.pages else []
            checks[key] = {"identity": identity, "pages": pages}
        print(json.dumps({"ok": True, "marker": receipt["marker"], "checks": checks}, ensure_ascii=True, sort_keys=True))
    finally:
        clear_test_session(project)


if __name__ == "__main__":
    main()
