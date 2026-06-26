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
import sys
import time
from pathlib import Path

import paramiko

ENV_CONFIG = {
    "dev": {
        "remote_dir": "/root/scheduling-backend-dev",
        "db_path": "/root/scheduling-data/dev/scheduling.db",
    },
    "staging": {
        "remote_dir": "/root/scheduling-backend-staging",
        "db_path": "/root/scheduling-data/staging/scheduling.db",
    },
    "prod": {
        "remote_dir": "/root/scheduling-backend",
        "db_path": "/root/scheduling-data/prod/scheduling.db",
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
HOST = os.getenv("DEPLOY_HOST")
PORT = int(os.getenv("DEPLOY_PORT", "22"))
USER = os.getenv("DEPLOY_USER", "root")
PASSWORD = os.getenv("DEPLOY_PASSWORD")
KEY_PATH = os.getenv("DEPLOY_KEY_PATH")
REMOTE_DIR = os.getenv("DEPLOY_REMOTE_DIR", DEFAULTS["remote_dir"])
DB_PATH = os.getenv("DB_PATH", DEFAULTS["db_path"])
READ_DB_PATH = os.getenv("READ_DB_PATH", DB_PATH)
LOCAL_DIR = Path(os.getenv("DEPLOY_LOCAL_DIR", Path(__file__).resolve().parents[1] / "backend"))


def require_remote_env():
    missing = [name for name, value in {
        "DEPLOY_HOST": HOST,
    }.items() if not value]
    if not PASSWORD and not KEY_PATH:
        missing.append("DEPLOY_PASSWORD or DEPLOY_KEY_PATH")
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")


def run(ssh, cmd, timeout=30):
    print(f">>> {cmd}")
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        print(out)
    if err.strip():
        print(f"STDERR: {err}")
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


def remote_env_prefix():
    env = {
        "APP_ENV": APP_ENV,
        "SCHEDULE_ENV": APP_ENV,
        "DB_PATH": DB_PATH,
        "READ_DB_PATH": READ_DB_PATH,
        "GEWU_NODE_ROLE": os.getenv("GEWU_NODE_ROLE", "primary-host"),
        "GEWU_DEVICE_ID": os.getenv("GEWU_DEVICE_ID", "desktop_host_001"),
        "GEWU_HOST_BASE_URL": os.getenv("GEWU_HOST_BASE_URL", "http://127.0.0.1:3001"),
        "GEWU_CLOUD_BASE_URL": os.getenv("GEWU_CLOUD_BASE_URL", "https://your-domain.example.com"),
        "QUESTION_BANK_ROOT": os.getenv("QUESTION_BANK_ROOT", "/root/GewuQuestionBank"),
        "QUESTION_BANK_UPLOAD_DIR": os.getenv("QUESTION_BANK_UPLOAD_DIR", "/root/GewuQuestionBank/assets"),
        "GEWU_LOCAL_CACHE_PATH": os.getenv("GEWU_LOCAL_CACHE_PATH", "/root/GewuQuestionBankCache"),
        "GEWU_NAS_BACKUP_PATH": os.getenv("GEWU_NAS_BACKUP_PATH", ""),
    }
    return " ".join(f"{key}='{value}'" for key, value in env.items())


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
            run(ssh, "npm install -g pm2 2>/dev/null || echo 'pm2 install skipped'")
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
            run(ssh, "curl -s http://localhost:3001/api/health || echo 'health check failed'")
        elif mode == "status":
            run(ssh, "pm2 status")
            run(ssh, "curl -s http://localhost:3001/api/health")
        else:
            raise SystemExit(f"Unknown mode: {mode}")
    finally:
        ssh.close()
        print("Done")


if __name__ == "__main__":
    main()
