#!/usr/bin/env python3
"""Environment-aware backend deploy helper.

Modes:
  check          Validate remote runtime.
  deploy         Upload backend files and restart pm2.
  migrate        Run idempotent schema initialization on the remote host.
  rollback-plan  Print the snapshot-based rollback steps for the selected env.

Required env:
  DEPLOY_HOST, DEPLOY_USER, DEPLOY_PASSWORD or DEPLOY_KEY_PATH

Optional env:
  DEPLOY_PORT, APP_ENV, DEPLOY_REMOTE_DIR, DEPLOY_LOCAL_DIR, DB_PATH, READ_DB_PATH
"""
import os
import json
import re
import secrets
import shlex
import sys
import time
from pathlib import Path

import paramiko

try:
    from dotenv import load_dotenv
except ImportError as error:
    raise SystemExit(
        "Missing deploy dependency python-dotenv. "
        "Run: python -m pip install -r scripts/requirements-deploy.txt"
    ) from error


PROJECT_ROOT = Path(__file__).resolve().parents[1]
dotenv_path = Path(os.getenv("DOTENV_CONFIG_PATH") or PROJECT_ROOT / ".env.local")
if dotenv_path.exists():
    load_dotenv(dotenv_path=dotenv_path, override=False)

ENV_CONFIG = {
    "dev": {
        "remote_dir": "/root/scheduling-backend-dev",
        "db_path": "/root/scheduling-data/dev/scheduling.db",
        "app_port": "3001",
    },
    "staging": {
        "remote_dir": "/root/scheduling-backend-staging",
        "db_path": "/root/scheduling-data/staging/scheduling.db",
        "app_port": "3001",
    },
    "prod": {
        "remote_dir": "/root/scheduling-backend",
        "db_path": "/root/scheduling-data/prod/scheduling.db",
        "app_port": "3002",
    },
}


def normalize_env(value):
    raw = (value or "dev").strip().lower()
    if raw == "production":
        return "prod"
    if raw == "development":
        return "dev"
    if raw not in ENV_CONFIG:
        raise SystemExit(f"Unsupported APP_ENV={raw}. Use dev, staging, or prod.")
    return raw


APP_ENV = normalize_env(os.getenv("APP_ENV") or os.getenv("SCHEDULE_ENV"))
DEFAULTS = ENV_CONFIG[APP_ENV]
APP_PORT = os.getenv("PORT", DEFAULTS["app_port"])
HOST = os.getenv("DEPLOY_HOST")
PORT = int(os.getenv("DEPLOY_PORT", "22"))
USER = os.getenv("DEPLOY_USER", "root")
PASSWORD = os.getenv("DEPLOY_PASSWORD")
KEY_PATH = os.getenv("DEPLOY_KEY_PATH")
BACKEND_JWT_SECRET = os.getenv("BACKEND_JWT_SECRET")
WECHAT_APPID = os.getenv("WECHAT_APPID")
WECHAT_APPSECRET = os.getenv("WECHAT_APPSECRET")
MINIAPP_REVIEW_EXPERIENCE_CODE = os.getenv("MINIAPP_REVIEW_EXPERIENCE_CODE")
REVIEW_CODE_POLICY = json.loads(
    (Path(__file__).resolve().parent / "review-experience-code-policy.json").read_text(encoding="utf-8")
)
REMOTE_DIR = os.getenv("DEPLOY_REMOTE_DIR", DEFAULTS["remote_dir"])
DB_PATH = os.getenv("DB_PATH", DEFAULTS["db_path"])
READ_DB_PATH = os.getenv("READ_DB_PATH", DB_PATH)
LOCAL_DIR = Path(os.getenv("DEPLOY_LOCAL_DIR", Path(__file__).resolve().parents[1] / "backend"))


def read_root_version():
    try:
        root_package = Path(__file__).resolve().parents[1] / "package.json"
        return json.loads(root_package.read_text(encoding="utf-8")).get("version") or ""
    except Exception:
        return ""


def require_remote_env():
    missing = [name for name, value in {
        "DEPLOY_HOST": HOST,
    }.items() if not value]
    if not PASSWORD and not KEY_PATH:
        missing.append("DEPLOY_PASSWORD or DEPLOY_KEY_PATH")
    if APP_ENV == "prod":
        if not WECHAT_APPID:
            missing.append("WECHAT_APPID")
        if not WECHAT_APPSECRET:
            missing.append("WECHAT_APPSECRET")
        if not MINIAPP_REVIEW_EXPERIENCE_CODE:
            missing.append("MINIAPP_REVIEW_EXPERIENCE_CODE")
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")
    if MINIAPP_REVIEW_EXPERIENCE_CODE:
        validate_review_experience_code(MINIAPP_REVIEW_EXPERIENCE_CODE)


def validate_review_experience_code(value):
    raw = str(value or "")
    normalized = raw.strip()
    lower = normalized.lower()
    has_repeated_substring = False
    minimum_repeat = int(REVIEW_CODE_POLICY["minRepeatedSubstringLength"])
    for size in range(minimum_repeat, len(normalized) // 2 + 1):
        for start in range(0, len(normalized) - size + 1):
            candidate = normalized[start:start + size]
            if normalized.find(candidate, start + size) >= 0:
                has_repeated_substring = True
                break
        if has_repeated_substring:
            break
    sequence_length = int(REVIEW_CODE_POLICY["sequenceLength"])
    has_sequence = False
    for seed in REVIEW_CODE_POLICY["sequenceSeeds"]:
        for sequence in (seed, seed[::-1]):
            if any(sequence[index:index + sequence_length] in lower for index in range(len(sequence) - sequence_length + 1)):
                has_sequence = True
                break
        if has_sequence:
            break
    strong = (
        raw == normalized
        and int(REVIEW_CODE_POLICY["minLength"]) <= len(normalized) <= int(REVIEW_CODE_POLICY["maxLength"])
        and all(0x21 <= ord(character) <= 0x7E for character in normalized)
        and any("a" <= character <= "z" for character in normalized)
        and any("A" <= character <= "Z" for character in normalized)
        and any(character.isdigit() for character in normalized)
        and any(not ("a" <= character.lower() <= "z" or character.isdigit()) for character in normalized)
        and len(set(normalized)) >= int(REVIEW_CODE_POLICY["minUniqueCharacters"])
        and not any(term in lower for term in REVIEW_CODE_POLICY["forbiddenTerms"])
        and re.search(r"(?:19|20)\d{2}", normalized) is None
        and re.search(r"\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?", normalized) is None
        and re.search(r"(.)\1{%d,}" % int(REVIEW_CODE_POLICY["maxRepeatedCharacterRun"]), normalized) is None
        and not has_repeated_substring
        and not has_sequence
        and normalized != "<review experience code>"
    )
    if not strong:
        raise SystemExit("MINIAPP_REVIEW_EXPERIENCE_CODE is missing or weak")
    return True


def redaction_candidates():
    candidates = []
    for secret in [
        PASSWORD,
        BACKEND_JWT_SECRET,
        WECHAT_APPSECRET,
        MINIAPP_REVIEW_EXPERIENCE_CODE,
        os.getenv("GEWU_DESKTOP_SYNC_TOKEN"),
        os.getenv("GEWU_CLOUD_RELAY_HOST_TOKEN"),
    ]:
        if secret:
            value = str(secret)
            candidates.extend([value, shlex.quote(value)])
    return sorted(set(candidates), key=len, reverse=True)


def redact_text(value):
    redacted = str(value)
    for candidate in redaction_candidates():
        redacted = redacted.replace(candidate, "<redacted>")
    return redacted


def redact_command(cmd):
    return redact_text(cmd)


def safe_print(value=""):
    try:
        print(value)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
        print(str(value).encode(encoding, errors="replace").decode(encoding, errors="replace"))


def run(ssh, cmd, timeout=30):
    safe_print(f">>> {redact_command(cmd)}")
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        safe_print(redact_text(out))
    if err.strip():
        safe_print(f"STDERR: {redact_text(err)}")
    return out, err


def connect():
    require_remote_env()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {HOST}:{PORT} env={APP_ENV} remote={REMOTE_DIR}")
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, key_filename=KEY_PATH, timeout=10)
    return ssh


def upload_backend(ssh):
    sftp = ssh.open_sftp()
    for root, dirs, files in os.walk(LOCAL_DIR):
        dirs[:] = [d for d in dirs if d not in {"node_modules", "data"}]
        for filename in files:
            if filename.endswith((".db", ".db-wal", ".db-shm")):
                continue
            local_path = Path(root) / filename
            rel_path = local_path.relative_to(LOCAL_DIR).as_posix()
            remote_path = f"{REMOTE_DIR}/{rel_path}"
            remote_parent = os.path.dirname(remote_path)
            run(ssh, f"mkdir -p '{remote_parent}'")
            sftp.put(str(local_path), remote_path)
            print(f"  OK: {rel_path}")
    sftp.close()


def remote_env_values():
    return {
        "NODE_ENV": "production" if APP_ENV == "prod" else APP_ENV,
        "PORT": APP_PORT,
        "APP_ENV": APP_ENV,
        "SCHEDULE_ENV": APP_ENV,
        "JWT_SECRET": BACKEND_JWT_SECRET,
        "WECHAT_APPID": WECHAT_APPID,
        "WECHAT_APPSECRET": WECHAT_APPSECRET,
        "MINIAPP_REVIEW_EXPERIENCE_CODE": MINIAPP_REVIEW_EXPERIENCE_CODE,
        "DB_PATH": DB_PATH,
        "READ_DB_PATH": READ_DB_PATH,
        "GEWU_NODE_ROLE": os.getenv("GEWU_NODE_ROLE", "primary-host"),
        "GEWU_DEVICE_ID": os.getenv("GEWU_DEVICE_ID", "desktop_host_001"),
        "GEWU_HOST_BASE_URL": os.getenv("GEWU_HOST_BASE_URL", f"http://127.0.0.1:{APP_PORT}"),
        "GEWU_CLOUD_BASE_URL": os.getenv("GEWU_CLOUD_BASE_URL", "https://your-domain.example.com"),
        "GEWU_DESKTOP_SYNC_TOKEN": os.getenv("GEWU_DESKTOP_SYNC_TOKEN", ""),
        "GEWU_CLOUD_RELAY_HOST_TOKEN": os.getenv("GEWU_CLOUD_RELAY_HOST_TOKEN", os.getenv("GEWU_DESKTOP_SYNC_TOKEN", "")),
        "GEWU_APP_VERSION": os.getenv("GEWU_APP_VERSION", read_root_version()),
        "QUESTION_BANK_ROOT": os.getenv("QUESTION_BANK_ROOT", "/root/GewuQuestionBank"),
        "QUESTION_BANK_UPLOAD_DIR": os.getenv("QUESTION_BANK_UPLOAD_DIR", "/root/GewuQuestionBank/assets"),
        "GEWU_LOCAL_CACHE_PATH": os.getenv("GEWU_LOCAL_CACHE_PATH", "/root/GewuQuestionBankCache"),
        "GEWU_NAS_BACKUP_PATH": os.getenv("GEWU_NAS_BACKUP_PATH", ""),
    }


def remote_env_prefix():
    env = remote_env_values()
    return " ".join(f"{key}={shlex.quote(str(value or ''))}" for key, value in env.items())


def serialize_remote_env_file(values=None):
    env = values or remote_env_values()
    lines = []
    for key, value in env.items():
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", str(key)):
            raise ValueError("Invalid remote environment key")
        text = str(value or "")
        if any(character in text for character in ("\x00", "\r", "\n")):
            raise ValueError(f"Remote environment value contains a forbidden control character: {key}")
        lines.append(f"export {key}={shlex.quote(text)}")
    return "\n".join(lines) + "\n"


def upload_remote_env_file(ssh, path_factory=None):
    factory = path_factory or (lambda: f"/tmp/gewu-pm2-env-{secrets.token_hex(16)}")
    remote_path = str(factory())
    if not re.fullmatch(r"/tmp/gewu-pm2-env-[A-Za-z0-9_-]{8,64}", remote_path):
        raise ValueError("Invalid remote environment path")
    sftp = ssh.open_sftp()
    remote_file = None
    try:
        remote_file = sftp.file(remote_path, "w")
        sftp.chmod(remote_path, 0o600)
        remote_file.write(serialize_remote_env_file())
        remote_file.flush()
        return remote_path
    except Exception:
        try:
            sftp.remove(remote_path)
        except Exception:
            pass
        raise
    finally:
        if remote_file is not None:
            remote_file.close()
        sftp.close()


def remove_remote_env_file(ssh, remote_path):
    if not re.fullmatch(r"/tmp/gewu-pm2-env-[A-Za-z0-9_-]{8,64}", str(remote_path)):
        raise ValueError("Invalid remote environment path")
    sftp = ssh.open_sftp()
    try:
        try:
            sftp.remove(remote_path)
        except FileNotFoundError:
            pass
    finally:
        sftp.close()


def migrate(ssh):
    run(ssh, f"mkdir -p '{os.path.dirname(DB_PATH)}'")
    cmd = (
        f"cd '{REMOTE_DIR}' && {remote_env_prefix()} "
        "node -e \"const { getInstance } = require('./src/database'); "
        "const db = getInstance(); console.log(JSON.stringify(db.getSchemaStatus(), null, 2)); db.close();\""
    )
    run(ssh, cmd, timeout=60)


def rollback_plan():
    print("Rollback plan for single-file schema:")
    print(f"1. Stop service: pm2 stop scheduling-backend-{APP_ENV}")
    print(f"2. Restore DB snapshot to: {DB_PATH}")
    print(f"3. Keep APP_ENV={APP_ENV}, DB_PATH={DB_PATH}, READ_DB_PATH={READ_DB_PATH}")
    print("4. Restart the previous code version and verify /api/health.")
    print("5. Do not roll back code alone if the DB schema was already changed.")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"

    if mode == "rollback-plan":
        rollback_plan()
        return

    ssh = connect()
    try:
        if mode == "check":
            run(ssh, "node -v")
            run(ssh, "npm -v")
            run(ssh, "which pm2 || echo 'pm2 not installed'")
            run(ssh, f"ls -ld '{REMOTE_DIR}' 2>/dev/null || true")
        elif mode == "migrate":
            migrate(ssh)
        elif mode == "deploy":
            run(ssh, f"mkdir -p '{REMOTE_DIR}' '{os.path.dirname(DB_PATH)}'")
            upload_backend(ssh)
            run(ssh, f"cd '{REMOTE_DIR}' && npm install --production 2>&1", timeout=300)
            run(ssh, "which pm2 || npm install -g pm2 2>/dev/null || echo 'pm2 install skipped'", timeout=120)
            migrate(ssh)
            service_name = f"scheduling-backend-{APP_ENV}"
            run(ssh, f"pm2 stop {service_name} 2>/dev/null || true")
            run(ssh, f"pm2 delete {service_name} 2>/dev/null || true")
            run(
                ssh,
                f"cd '{REMOTE_DIR}' && {remote_env_prefix()} pm2 start server.js --name {service_name}",
                timeout=30,
            )
            run(ssh, "pm2 save")
            time.sleep(2)
            run(ssh, "pm2 status")
            health_port = APP_PORT
            run(ssh, f"curl -s http://localhost:{health_port}/api/health || echo 'health check failed'")
        elif mode == "status":
            run(ssh, "pm2 status")
            health_port = APP_PORT
            run(ssh, f"curl -s http://localhost:{health_port}/api/health")
        else:
            raise SystemExit(f"Unknown mode: {mode}")
    finally:
        ssh.close()
        print("Done")


if __name__ == "__main__":
    main()
