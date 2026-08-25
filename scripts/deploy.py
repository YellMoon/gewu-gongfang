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
import posixpath
import re
import secrets
import shlex
import subprocess
import sys
import time
from datetime import datetime
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
    "relay-e2e": {
        "remote_dir": "/root/scheduling-backend-relay-e2e",
        "db_path": "/root/scheduling-data/relay-e2e/scheduling.db",
        "app_port": "3011",
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
        raise SystemExit(f"Unsupported APP_ENV={raw}. Use dev, staging, relay-e2e, or prod.")
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
GEWU_SSH_KNOWN_HOSTS = os.getenv("GEWU_SSH_KNOWN_HOSTS")
WECHAT_APPID = os.getenv("WECHAT_APPID")
WECHAT_APPSECRET = os.getenv("WECHAT_APPSECRET")
WECHAT_MINIAPP_ENV_VERSION = os.getenv("WECHAT_MINIAPP_ENV_VERSION", "release").strip()
REMOTE_DIR = os.getenv("DEPLOY_REMOTE_DIR", DEFAULTS["remote_dir"])
DB_PATH = os.getenv("DB_PATH", DEFAULTS["db_path"])
READ_DB_PATH = os.getenv("READ_DB_PATH", DB_PATH)
LOCAL_DIR = Path(os.getenv("DEPLOY_LOCAL_DIR", Path(__file__).resolve().parents[1] / "backend"))
LOCAL_SHARED_DIR = PROJECT_ROOT / "shared"


def read_root_version():
    try:
        root_package = Path(__file__).resolve().parents[1] / "package.json"
        return json.loads(root_package.read_text(encoding="utf-8")).get("version") or ""
    except Exception:
        return ""


RELEASE_MATRIX_PATH = Path(os.getenv("GEWU_RELEASE_MANIFEST_PATH", PROJECT_ROOT / "output" / "release-matrix" / "active.json"))
RELEASE_MATRIX_SCHEMA = "gewu.unified-release.v1"
RELEASE_MATRIX_TARGETS = ("desktop", "cloud_business", "storage_proxy", "miniapp")


def current_source_commit():
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit("Unable to resolve the checked-out source commit for unified release") from error
    commit = result.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit("Checked-out source commit is invalid for unified release")
    return commit


def require_release_manifest(target, allowed_statuses=("pending",)):
    """Fail closed unless this deployment belongs to the one prepared release."""
    if target not in RELEASE_MATRIX_TARGETS:
        raise SystemExit(f"Unknown unified release target: {target}")
    if (not isinstance(allowed_statuses, tuple) or not allowed_statuses
            or any(status not in ("pending", "verified") for status in allowed_statuses)):
        raise SystemExit("Unified release target status policy is invalid")
    if not RELEASE_MATRIX_PATH.is_file():
        raise SystemExit(f"Unified release manifest is required before deploy: {RELEASE_MATRIX_PATH}")
    try:
        manifest = json.loads(RELEASE_MATRIX_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit("Unified release manifest is unreadable") from error
    expected_version = read_root_version()
    if manifest.get("schema") != RELEASE_MATRIX_SCHEMA or manifest.get("version") != expected_version:
        raise SystemExit("Unified release manifest does not match the checked-out source version")
    if manifest.get("commit") != current_source_commit():
        raise SystemExit("Unified release manifest does not match the checked-out source commit")
    package_paths = {
        "desktop": PROJECT_ROOT / "package.json",
        "cloud_business": PROJECT_ROOT / "cloud-business-api" / "package.json",
        "miniapp": PROJECT_ROOT / "miniapp" / "package.json",
    }
    stale = []
    for name, package_path in package_paths.items():
        try:
            version = json.loads(package_path.read_text(encoding="utf-8")).get("version")
        except (OSError, json.JSONDecodeError) as error:
            raise SystemExit(f"Unable to read {name} package version for unified release") from error
        if version != expected_version:
            stale.append(f"{name}={version or '<empty>'}")
    if stale:
        raise SystemExit(f"Unified source version mismatch: {', '.join(stale)}; expected {expected_version}")
    target_state = (manifest.get("targets") or {}).get(target)
    if not isinstance(target_state, dict) or target_state.get("status") not in allowed_statuses:
        raise SystemExit(f"Unified release target {target} is not in an allowed state")
    if target_state.get("status") == "verified":
        receipt = target_state.get("receipt")
        if (not isinstance(receipt, dict) or receipt.get("version") != expected_version
                or not isinstance(receipt.get("verifiedAt"), str) or not receipt.get("verifiedAt")
                or not isinstance(receipt.get("evidence"), str) or not receipt.get("evidence")):
            raise SystemExit(f"Unified release target {target} has an invalid verified receipt")
    return manifest


def record_release_receipt(target, evidence):
    manifest = require_release_manifest(target)
    manifest["targets"][target] = {
        "status": "verified",
        "receipt": {
            "version": manifest["version"],
            "verifiedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "evidence": str(evidence),
        },
    }
    RELEASE_MATRIX_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def require_remote_env():
    missing = [name for name, value in {
        "DEPLOY_HOST": HOST,
    }.items() if not value]
    if not PASSWORD and not KEY_PATH:
        missing.append("DEPLOY_PASSWORD or DEPLOY_KEY_PATH")
    if APP_ENV == "prod":
        if not BACKEND_JWT_SECRET:
            missing.append("BACKEND_JWT_SECRET")
        if not WECHAT_APPID:
            missing.append("WECHAT_APPID")
        if not WECHAT_APPSECRET:
            missing.append("WECHAT_APPSECRET")
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")
    if BACKEND_JWT_SECRET:
        validate_backend_jwt_secret(BACKEND_JWT_SECRET)


def validate_backend_jwt_secret(value):
    raw = str(value or "")
    normalized = raw.strip()
    lower = normalized.lower()
    strong = (
        raw == normalized
        and len(normalized) >= 32
        and all(0x21 <= ord(character) <= 0x7E for character in normalized)
        and any("a" <= character <= "z" for character in normalized)
        and any("A" <= character <= "Z" for character in normalized)
        and any(character.isdigit() for character in normalized)
        and any(not character.isalnum() for character in normalized)
        and len(set(normalized)) >= 12
        and not any(term in lower for term in ("change-me", "changeme", "default", "password", "jwt-secret"))
    )
    if not strong:
        raise SystemExit("BACKEND_JWT_SECRET is missing or weak (minimum 32 characters)")
    return True


def redaction_candidates():
    candidates = []
    for secret in [
        PASSWORD,
        BACKEND_JWT_SECRET,
        WECHAT_APPSECRET,
        # Redact historical environment names as well, even though deployment no
        # longer accepts them for relay authentication.
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


class RemoteCommandError(RuntimeError):
    def __init__(self, exit_status):
        self.exit_status = int(exit_status)
        super().__init__(f"Remote command failed (exit status {self.exit_status})")


class RemoteHealthError(RuntimeError):
    pass


class RemoteEnvironmentCleanupError(RuntimeError):
    pass


def run(ssh, cmd, timeout=30):
    safe_print(f">>> {redact_command(cmd)}")
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        safe_print(redact_text(out))
    if err.strip():
        safe_print(f"STDERR: {redact_text(err)}")
    channel = getattr(stdout, "channel", None)
    if channel is None or not hasattr(channel, "recv_exit_status"):
        raise RemoteCommandError(-1)
    exit_status = channel.recv_exit_status()
    if exit_status != 0:
        raise RemoteCommandError(exit_status)
    return out, err


def _server_host_key_name(host, port):
    return str(host) if int(port) == 22 else f"[{host}]:{int(port)}"


def _host_key_is_trusted(ssh, host, port):
    server_name = _server_host_key_name(host, port)
    stores = [getattr(ssh, "_system_host_keys", None), getattr(ssh, "_host_keys", None)]
    return any(store is not None and store.lookup(server_name) for store in stores)


def configure_host_key_verification(ssh):
    ssh.load_system_host_keys()
    if GEWU_SSH_KNOWN_HOSTS:
        configured = Path(GEWU_SSH_KNOWN_HOSTS).expanduser()
        if not configured.is_absolute():
            raise SystemExit("GEWU_SSH_KNOWN_HOSTS must be an absolute file path")
        try:
            resolved = configured.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise SystemExit("GEWU_SSH_KNOWN_HOSTS must reference a readable file") from error
        if not resolved.is_file():
            raise SystemExit("GEWU_SSH_KNOWN_HOSTS must reference a readable file")
        try:
            ssh.load_host_keys(str(resolved))
        except (OSError, paramiko.SSHException) as error:
            raise SystemExit("GEWU_SSH_KNOWN_HOSTS could not be loaded") from error
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    if APP_ENV == "prod" and not _host_key_is_trusted(ssh, HOST, PORT):
        raise SystemExit("Production deployment trusted SSH host key required")


def connect():
    require_remote_env()
    ssh = paramiko.SSHClient()
    configure_host_key_verification(ssh)
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


def upload_shared(ssh):
    """Keep backend's sibling shared runtime modules deployable with it."""
    if not LOCAL_SHARED_DIR.is_dir():
        raise RuntimeError("Shared runtime directory is missing")
    # REMOTE_DIR is a POSIX path even when this deployment helper runs on
    # Windows; pathlib.Path would otherwise create backslash paths remotely.
    remote_shared_dir = posixpath.join(posixpath.dirname(REMOTE_DIR), "shared")
    run(ssh, f"mkdir -p '{remote_shared_dir}'")
    sftp = ssh.open_sftp()
    try:
        for item in LOCAL_SHARED_DIR.iterdir():
            if item.is_file():
                sftp.put(str(item), f"{remote_shared_dir}/{item.name}")
                print(f"  OK: shared/{item.name}")
    finally:
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
        "WECHAT_MINIAPP_ENV_VERSION": WECHAT_MINIAPP_ENV_VERSION,
        "DB_PATH": DB_PATH,
        "READ_DB_PATH": READ_DB_PATH,
        "GEWU_NODE_ROLE": os.getenv("GEWU_NODE_ROLE", "cloud-relay"),
        "GEWU_DEVICE_ID": os.getenv("GEWU_DEVICE_ID", "cloud_backend_prod"),
        "GEWU_HOST_BASE_URL": os.getenv("GEWU_HOST_BASE_URL", f"http://127.0.0.1:{APP_PORT}"),
        "GEWU_CLOUD_BASE_URL": os.getenv("GEWU_CLOUD_BASE_URL", "https://your-domain.example.com"),
        # A release deployment is versioned by the checked-out source and its
        # release manifest.  Carrying an old operator environment value here
        # makes a newly deployed gateway report a stale version, defeating the
        # unified-release health gate.
        "GEWU_APP_VERSION": read_root_version(),
        "QUESTION_BANK_ROOT": os.getenv("QUESTION_BANK_ROOT", "/root/GewuQuestionBank"),
        "QUESTION_BANK_UPLOAD_DIR": os.getenv("QUESTION_BANK_UPLOAD_DIR", "/root/GewuQuestionBank/assets"),
        "GEWU_LOCAL_CACHE_PATH": os.getenv("GEWU_LOCAL_CACHE_PATH", "/root/GewuQuestionBankCache"),
        "GEWU_NAS_BACKUP_PATH": os.getenv("GEWU_NAS_BACKUP_PATH", ""),
    }


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
    primary_error = None
    removed = False
    try:
        remote_file = sftp.file(remote_path, "w")
        sftp.chmod(remote_path, 0o600)
        remote_file.write(serialize_remote_env_file())
        remote_file.flush()
    except Exception as error:
        primary_error = error
    if remote_file is not None:
        try:
            remote_file.close()
        except Exception as error:
            if primary_error is None:
                primary_error = error
    if primary_error is not None:
        try:
            sftp.remove(remote_path)
            removed = True
        except Exception:
            pass
    try:
        sftp.close()
    except Exception as error:
        if primary_error is None:
            primary_error = error
    if primary_error is not None and not removed:
        cleanup_sftp = None
        try:
            cleanup_sftp = ssh.open_sftp()
            cleanup_sftp.remove(remote_path)
        except Exception:
            pass
        finally:
            if cleanup_sftp is not None:
                try:
                    cleanup_sftp.close()
                except Exception:
                    pass
        raise primary_error
    if primary_error is not None:
        raise primary_error
    return remote_path


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


def remote_env_shell_command(remote_path, command):
    if not re.fullmatch(r"/tmp/gewu-pm2-env-[A-Za-z0-9_-]{8,64}", str(remote_path)):
        raise ValueError("Invalid remote environment path")
    quoted_path = shlex.quote(str(remote_path))
    cleanup = shlex.quote(f"rm -f -- {quoted_path}")
    return f"trap {cleanup} EXIT HUP INT TERM; set -a; . {quoted_path}; set +a; {command}"


def run_with_remote_env(ssh, command, timeout=30, path_factory=None):
    remote_path = upload_remote_env_file(ssh, path_factory=path_factory)
    try:
        result = run(ssh, remote_env_shell_command(remote_path, command), timeout=timeout)
    except Exception as primary_error:
        try:
            remove_remote_env_file(ssh, remote_path)
        except Exception:
            if hasattr(primary_error, "add_note"):
                primary_error.add_note("Remote environment cleanup also failed")
        raise
    try:
        remove_remote_env_file(ssh, remote_path)
    except Exception as error:
        raise RemoteEnvironmentCleanupError("Remote environment cleanup failed") from error
    return result


def migrate(ssh, path_factory=None):
    run(ssh, f"mkdir -p '{os.path.dirname(DB_PATH)}'")
    cmd = (
        f"cd '{REMOTE_DIR}' && "
        "node -e \"const { getInstance } = require('./src/database'); "
        "const db = getInstance(); console.log(JSON.stringify(db.getSchemaStatus(), null, 2)); db.close();\""
    )
    run_with_remote_env(ssh, cmd, timeout=60, path_factory=path_factory)


def start_backend_service(ssh, service_name, path_factory=None):
    command = (
        f"cd '{REMOTE_DIR}' && "
        f"(pm2 describe {service_name} >/dev/null 2>&1 "
        f"&& pm2 restart {service_name} --update-env "
        f"|| pm2 start server.js --name {service_name} --update-env)"
    )
    return run_with_remote_env(ssh, command, timeout=30, path_factory=path_factory)


def check_remote_health(ssh, port, component, expected_version):
    out, _ = run(
        ssh,
        f"curl --fail --silent --show-error --max-time 15 http://localhost:{port}/api/health",
        timeout=30,
    )
    try:
        body = json.loads(out)
    except (TypeError, ValueError) as error:
        raise RemoteHealthError(f"{component} health response has an invalid JSON contract") from error
    valid = (
        isinstance(body, dict)
        and body.get("ok") is True
        and isinstance(body.get("time"), str)
        and bool(body["time"].strip())
        and isinstance(body.get("version"), str)
        and body["version"] == expected_version
    )
    if not valid:
        raise RemoteHealthError(f"{component} health response has an invalid JSON contract")
    return body


def wait_for_remote_health(ssh, port, component, expected_version, attempts=12, delay_seconds=1):
    bounded_attempts = int(attempts)
    if bounded_attempts < 1:
        raise ValueError("health attempts must be at least 1")
    delay = max(0, float(delay_seconds))
    last_error = None
    for attempt in range(bounded_attempts):
        try:
            return check_remote_health(ssh, port, component, expected_version)
        except (RemoteCommandError, RemoteHealthError) as error:
            last_error = error
            if attempt + 1 < bounded_attempts and delay:
                time.sleep(delay)
    raise RemoteHealthError(
        f"{component} health did not become ready after {bounded_attempts} attempts"
    ) from last_error


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

    if mode == "deploy":
        require_release_manifest('backend')

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
            upload_shared(ssh)
            run(ssh, f"cd '{REMOTE_DIR}' && npm install --production 2>&1", timeout=300)
            run(ssh, "which pm2 || npm install -g pm2 2>/dev/null || echo 'pm2 install skipped'", timeout=120)
            migrate(ssh)
            service_name = f"scheduling-backend-{APP_ENV}"
            run(ssh, f"pm2 stop {service_name} 2>/dev/null || true")
            run(ssh, f"pm2 delete {service_name} 2>/dev/null || true")
            start_backend_service(ssh, service_name)
            run(ssh, "pm2 save")
            time.sleep(2)
            run(ssh, "pm2 status")
            health_port = APP_PORT
            check_remote_health(ssh, health_port, "backend", read_root_version())
            record_release_receipt('backend', f"backend health /api/health on port {health_port}")
        elif mode == "status":
            run(ssh, "pm2 status")
            health_port = APP_PORT
            check_remote_health(ssh, health_port, "backend", read_root_version())
        else:
            raise SystemExit(f"Unknown mode: {mode}")
    finally:
        ssh.close()
        print("Done")


if __name__ == "__main__":
    main()
