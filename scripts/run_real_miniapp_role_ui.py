#!/usr/bin/env python3
"""Run real-cloud miniapp role checks with short-lived, non-personal E2E sessions."""

import argparse
import json
import re
import secrets
import subprocess
import sys
import tempfile
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


def verify_identity(project, session):
    key = ACCOUNT_PATTERN.fullmatch(session["accountId"]).group(1)
    user = user_for_session(key, session["accountId"])
    run_wx_api(project, "setStorageSync", ["auth_token", session["token"]])
    run_wx_api(project, "setStorageSync", ["user_info", user])
    run_wx_api(project, "removeStorageSync", ["user_permissions"])
    run_wx_api(project, "removeStorageSync", ["__gewu_auth_session_state__"])
    result = run_wechatide(["automation_evaluate", "--project", str(project), "--fn-source", "() => { const user = wx.getStorageSync('user_info'); return { accountId: user && user.id, role: user && user.role, identityKind: user && user.identity_kind || null, accountState: user && user.account_state }; }"])
    if not isinstance(result, dict) or result.get("accountId") != session["accountId"] or result.get("role") != user["role"]:
        raise RuntimeError(f"REAL_MINIAPP_ROLE_UI_INJECTION_INVALID:{json.dumps(result, ensure_ascii=True)[:500]}")
    return {key: result.get(key) for key in ("accountId", "role", "identityKind", "accountState")}


def verify_pages(project, pages):
    visited = []
    for page in pages:
        action = "switchTab" if page in {"/pages/schedule/index", "/pages/question-bank/index"} else "navigateTo"
        run_wechatide(["automation_navigate", "--project", str(project), "--action", action, "--url", page], timeout=45)
        runtime = run_wechatide(["automation_evaluate", "--project", str(project), "--fn-source", "() => ({ route: getCurrentPages().slice(-1)[0]?.route || null, user: wx.getStorageSync('user_info')?.user_type || null })"])
        expected_route = page.removeprefix("/")
        if not isinstance(runtime, dict) or runtime.get("route") != expected_route:
            raise RuntimeError("REAL_MINIAPP_ROLE_UI_PAGE_ROUTE_INVALID")
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
    args = parser.parse_args(argv)
    project = Path(args.project).resolve()
    if not project.is_dir():
        raise RuntimeError("REAL_MINIAPP_ROLE_UI_PROJECT_MISSING")
    receipt = fetch_sessions()
    checks = {}
    keys = (args.role,) if args.role else ROLE_KEYS
    for key in keys:
        identity = verify_identity(project, receipt["sessions"][key])
        pages = verify_pages(project, ROLE_PAGES[key]) if args.pages else []
        checks[key] = {"identity": identity, "pages": pages}
    print(json.dumps({"ok": True, "marker": receipt["marker"], "checks": checks}, ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
