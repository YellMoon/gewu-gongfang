import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('gewu_deploy', ROOT / 'scripts' / 'deploy.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


def run_checked(ssh, command, timeout=180):
    print(f">>> {deploy.redact_command(command)}", flush=True)
    _, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    status = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.strip(), flush=True)
    if err.strip():
        print(f"STDERR: {err.strip()}", flush=True)
    if status != 0:
        raise RuntimeError(f"remote backup command failed with exit status {status}")
    return out.strip()


def backup_sqlite(ssh, source, target, runtime_dir, helper):
    run_checked(ssh, f"test -f '{source}'")
    result = run_checked(ssh, f"cd '{runtime_dir}' && node '{helper}' '{source}' '{target}'")
    if result.splitlines()[-1:] != ['sqlite backup quick_check ok']:
        raise RuntimeError(f"SQLite backup verification failed for {target}")


def main():
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    backup_dir = f"/root/scheduling-backups/formula-pipeline/{stamp}"
    backend_code = f"{backup_dir}/backend-code.tar.gz"
    gateway_code = f"{backup_dir}/gateway-code.tar.gz"
    backend_db = f"{backup_dir}/scheduling.db"
    gateway_db = f"{backup_dir}/gateway.db"
    helper = f"{backup_dir}/cloud_sqlite_backup.js"
    remote_gateway = '/root/education-platform/gateway'
    remote_gateway_db = f"{remote_gateway}/data/gateway.db"
    ssh = deploy.connect()
    try:
        run_checked(ssh, f"mkdir -p '{backup_dir}'")
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(Path(__file__).with_name('cloud_sqlite_backup.js')), helper)
        finally:
            sftp.close()
        run_checked(ssh, f"tar -C '{deploy.REMOTE_DIR}' -czf '{backend_code}' --exclude=node_modules --exclude=data --exclude='.env*' .")
        run_checked(ssh, f"tar -C '{remote_gateway}' -czf '{gateway_code}' --exclude=node_modules --exclude=data --exclude='.env*' .")
        backup_sqlite(ssh, deploy.DB_PATH, backend_db, deploy.REMOTE_DIR, helper)
        backup_sqlite(ssh, remote_gateway_db, gateway_db, remote_gateway, helper)
        evidence = run_checked(
            ssh,
            f"sha256sum '{backend_code}' '{gateway_code}' '{backend_db}' '{gateway_db}' && stat -c '%n %s' '{backend_code}' '{gateway_code}' '{backend_db}' '{gateway_db}'",
        )
    finally:
        ssh.close()
    record = {
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'backupDir': backup_dir,
        'backendDatabaseSource': deploy.DB_PATH,
        'gatewayDatabaseSource': remote_gateway_db,
        'evidence': evidence.splitlines(),
    }
    target = Path(__file__).with_name('cloud-backup-latest.json')
    target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record, indent=2), flush=True)


if __name__ == '__main__':
    main()
