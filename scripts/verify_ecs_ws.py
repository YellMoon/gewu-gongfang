import os
import sys

import paramiko


def required_env(name):
    value = str(os.environ.get(name, "")).strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def run_checked(ssh, label, command):
    _stdin, stdout, stderr = ssh.exec_command(command)
    output = stdout.read().decode("utf-8", errors="replace").strip()
    error_output = stderr.read().decode("utf-8", errors="replace").strip()
    exit_status = stdout.channel.recv_exit_status()
    if exit_status != 0:
        details = error_output or output or f"exit status {exit_status}"
        raise RuntimeError(f"{label} failed: {details}")
    print(f"{label}:\n{output or '(no matching log lines)'}")


def main():
    host = required_env("GEWU_ECS_SSH_HOST")
    username = required_env("GEWU_ECS_SSH_USER")
    key_filename = str(os.environ.get("GEWU_ECS_SSH_KEY_FILE", "")).strip() or None
    known_hosts_file = str(os.environ.get("GEWU_ECS_KNOWN_HOSTS_FILE", "")).strip() or None

    ssh = paramiko.SSHClient()
    if known_hosts_file:
        ssh.load_host_keys(known_hosts_file)
    else:
        ssh.load_system_host_keys()
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect(
        host,
        username=username,
        key_filename=key_filename,
        allow_agent=True,
        look_for_keys=True,
        timeout=15,
    )

    try:
        run_checked(
            ssh,
            "Backend WebSocket 日志",
            "pm2 logs scheduling-backend-prod --lines 50 --nostream 2>&1 | grep -i websocket | tail -5",
        )
        run_checked(
            ssh,
            "Gateway WebSocket 日志",
            "pm2 logs gateway --lines 50 --nostream 2>&1 | grep -i websocket | tail -5",
        )
    finally:
        ssh.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ECS WebSocket verification failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
