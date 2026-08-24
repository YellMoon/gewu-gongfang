import os
import sys
from pathlib import Path

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
        raise RuntimeError(f"{label} failed: {error_output or output or exit_status}")
    print(f"{label}: {output or '(no output)'}")


def main():
    host = required_env("GEWU_ECS_SSH_HOST")
    username = required_env("GEWU_ECS_SSH_USER")
    key_filename = str(os.environ.get("GEWU_ECS_SSH_KEY_FILE", "")).strip() or None
    known_hosts_file = str(os.environ.get("GEWU_ECS_KNOWN_HOSTS_FILE", "")).strip() or None
    project_root = Path(__file__).resolve().parents[1]
    remote_base = "/root/education-platform/modules/question-bank"

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
        sftp = ssh.open_sftp()
        try:
            for directory in ["parsers", "uploads"]:
                remote_directory = f"{remote_base}/{directory}"
                try:
                    sftp.stat(remote_directory)
                except FileNotFoundError:
                    sftp.mkdir(remote_directory)

            uploads = [
                (project_root / "modules/question-bank/parsers/parse_word.py", f"{remote_base}/parsers/parse_word.py"),
                (project_root / "modules/question-bank/src/index.js", f"{remote_base}/src/index.js"),
                (project_root / "modules/question-bank/src/routes/parse_word.js", f"{remote_base}/src/routes/parse_word.js"),
            ]
            for local_path, remote_path in uploads:
                if not local_path.is_file():
                    raise RuntimeError(f"local deployment file is missing: {local_path}")
                sftp.put(str(local_path), remote_path)
        finally:
            sftp.close()

        run_checked(ssh, "Install multer", "cd /root/education-platform && npm install multer")
        run_checked(ssh, "Install python-docx", "python3 -m pip install python-docx")
        run_checked(ssh, "Restart gateway", "pm2 restart edu-gateway")
        run_checked(
            ssh,
            "Verify parser logs",
            "grep -i 'parse-word\\|question-bank' /root/.pm2/logs/edu-gateway-out.log | tail -5",
        )
    finally:
        ssh.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Word parser deployment failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
