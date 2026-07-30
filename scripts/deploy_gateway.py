"""Deploy the formal gateway source and restart the remote PM2 process."""
import base64
import importlib.util
import json
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL_GATEWAY = ROOT / "gateway"
LOCAL_BACKEND = ROOT / "backend"
LOCAL_SHARED = ROOT / "shared"
REMOTE_GATEWAY = "/root/education-platform/gateway"
REMOTE_BACKEND = "/root/education-platform/backend"
REMOTE_SHARED = "/root/education-platform/shared"
SERVICE_NAME = "edu-gateway"
LEGACY_SERVICE_NAMES = ("gateway",)

spec = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
backend_deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend_deploy)


def mkdir_p(ssh, path):
  backend_deploy.run(ssh, f"mkdir -p '{path}'")


def upload_dir(sftp, ssh, local_dir, remote_dir, display_root=REMOTE_GATEWAY):
  mkdir_p(ssh, remote_dir)
  for item in local_dir.iterdir():
    if item.name in {"node_modules", "data", ".env", ".env.local"}:
      continue
    remote_path = f"{remote_dir}/{item.name}"
    if item.is_dir():
      upload_dir(sftp, ssh, item, remote_path, display_root=display_root)
    elif item.is_file():
      sftp.put(str(item), remote_path)
      print(f"  OK: {Path(remote_path).relative_to(display_root)}")


def upload_shared(sftp, ssh):
  """Upload shared directory to remote server."""
  mkdir_p(ssh, REMOTE_SHARED)
  for item in LOCAL_SHARED.iterdir():
    if item.is_file():
      remote_path = f"{REMOTE_SHARED}/{item.name}"
      sftp.put(str(item), remote_path)
      print(f"  OK: shared/{item.name}")


def upload_backend_support(sftp, ssh):
  """Mirror the backend sibling required by gateway authority modules."""
  upload_dir(sftp, ssh, LOCAL_BACKEND, REMOTE_BACKEND, display_root=REMOTE_BACKEND)


def backup_gateway_release(ssh, backup_dir):
  source_db = f"{REMOTE_GATEWAY}/data/gateway.db"
  backup_db = f"{backup_dir}/gateway.db"
  database_source = f"""
const Database = require('better-sqlite3');
const source = new Database({json.dumps(source_db)}, {{
  readonly: true,
  fileMustExist: true,
}});
const sourceCheck = source.pragma('quick_check', {{ simple: true }});
if (sourceCheck !== 'ok') {{
  source.close();
  throw new Error('GATEWAY_SOURCE_QUICK_CHECK_FAILED');
}}
source.backup({json.dumps(backup_db)})
  .then(() => {{
    const backup = new Database({json.dumps(backup_db)}, {{
      readonly: true,
      fileMustExist: true,
    }});
    const quickCheck = backup.pragma('quick_check', {{ simple: true }});
    backup.close();
    source.close();
    if (quickCheck !== 'ok') throw new Error('GATEWAY_BACKUP_QUICK_CHECK_FAILED');
    console.log('GATEWAY_DB_BACKUP_OK');
  }})
  .catch(error => {{
    try {{ source.close(); }} catch {{}}
    console.error(error.message);
    process.exit(1);
  }});
"""
  encoded_source = base64.b64encode(database_source.encode("utf-8")).decode("ascii")
  backend_deploy.run(
    ssh,
    f"cd '{REMOTE_GATEWAY}' && "
    f"node -e \"eval(Buffer.from('{encoded_source}','base64').toString('utf8'))\"",
    timeout=120,
  )
  backend_deploy.run(ssh, f"test -s '{backup_db}'")


def restart_gateway(ssh, path_factory=None):
  command = (
    f"cd '{REMOTE_GATEWAY}' && "
    f"(pm2 restart {SERVICE_NAME} --update-env 2>&1 "
    f"|| pm2 start src/app.js --name {SERVICE_NAME} --update-env)"
  )
  return backend_deploy.run_with_remote_env(ssh, command, timeout=120, path_factory=path_factory)


def stop_legacy_gateway_services(ssh):
  for service_name in LEGACY_SERVICE_NAMES:
    backend_deploy.run(ssh, f"pm2 stop {service_name} 2>/dev/null || true")
    backend_deploy.run(ssh, f"pm2 delete {service_name} 2>/dev/null || true")


def main():
  backend_deploy.require_release_manifest('gateway')
  ssh = backend_deploy.connect()
  try:
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backups/gateway/{stamp}"
    backend_deploy.run(ssh, f"mkdir -p '{backup_dir}'")
    backup_gateway_release(ssh, backup_dir)
    backend_deploy.run(ssh, f"if [ -d '{REMOTE_GATEWAY}' ]; then tar -C '{REMOTE_GATEWAY}' -czf '{backup_dir}/gateway-code.tar.gz' --exclude=node_modules --exclude=data .; fi")
    sftp = ssh.open_sftp()
    try:
      upload_dir(sftp, ssh, LOCAL_GATEWAY, REMOTE_GATEWAY)
      upload_backend_support(sftp, ssh)
      upload_shared(sftp, ssh)
    finally:
      sftp.close()
    backend_deploy.run(ssh, f"cd '{REMOTE_GATEWAY}' && npm install --production 2>&1", timeout=180)
    backend_deploy.run(ssh, f"cd '{REMOTE_BACKEND}' && npm install --production 2>&1", timeout=300)
    stop_legacy_gateway_services(ssh)
    restart_gateway(ssh)
    backend_deploy.run(ssh, "pm2 save", timeout=60)
    backend_deploy.wait_for_remote_health(
      ssh,
      3001,
      "gateway",
      backend_deploy.read_root_version(),
      attempts=12,
      delay_seconds=1,
    )
    backend_deploy.record_release_receipt('gateway', 'gateway health /api/health on port 3001')
  finally:
    ssh.close()


if __name__ == "__main__":
  main()
