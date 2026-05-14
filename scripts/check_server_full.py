import os
import sys

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def env(name, default=None):
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


host = env("SERVER_HOST")
port = int(os.environ.get("SERVER_PORT", "22"))
user = env("SERVER_USER", "root")
password = os.environ.get("SERVER_PASSWORD")
key_file = os.environ.get("SERVER_KEY_FILE")
base_url = os.environ.get("HEALTH_BASE_URL", "http://localhost:3001")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port, user, password=password, key_filename=key_file, timeout=10)


def run(cmd, timeout=20):
    _stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")[:3000]
    err = stderr.read().decode("utf-8", errors="replace")[:1000]
    print(f"$ {cmd}")
    if out.strip():
        print(out)
    if err.strip():
        print("ERR:", err)


commands = [
    "pm2 status 2>&1 || true",
    f"curl -s -H 'x-trace-id: check-full-health' {base_url}/api/health 2>&1 || echo FAIL",
    f"curl -s -H 'x-trace-id: check-full-deep' {base_url}/api/ops/health/deep 2>&1 || echo FAIL",
    "ss -tlnp | grep -E '80|443|3001' || true",
    "ps aux | grep -E 'node|python|fastapi|uvicorn|gunicorn' | grep -v grep || true",
    "tail -n 80 logs/error.log 2>/dev/null || true",
    "tail -n 80 logs/out.log 2>/dev/null || true",
]

for command in commands:
    run(command)

ssh.close()
