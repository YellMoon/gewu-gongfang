"""Deploy the formal gateway source and restart the remote PM2 process."""
import importlib.util
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL_GATEWAY = ROOT / "gateway"
REMOTE_GATEWAY = "/root/education-platform/gateway"
SERVICE_NAME = "edu-gateway"

spec = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
backend_deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend_deploy)


def mkdir_p(ssh, path):
  backend_deploy.run(ssh, f"mkdir -p '{path}'")


def upload_dir(sftp, ssh, local_dir, remote_dir):
  mkdir_p(ssh, remote_dir)
  for item in local_dir.iterdir():
    if item.name in {"node_modules", "data", ".env", ".env.local"}:
      continue
    remote_path = f"{remote_dir}/{item.name}"
    if item.is_dir():
      upload_dir(sftp, ssh, item, remote_path)
    elif item.is_file():
      sftp.put(str(item), remote_path)
      print(f"  OK: {Path(remote_path).relative_to(REMOTE_GATEWAY)}")


def main():
  ssh = backend_deploy.connect()
  try:
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backups/gateway/{stamp}"
    backend_deploy.run(ssh, f"mkdir -p '{backup_dir}'")
    backend_deploy.run(ssh, f"if [ -d '{REMOTE_GATEWAY}' ]; then tar -C '{REMOTE_GATEWAY}' -czf '{backup_dir}/gateway-code.tar.gz' --exclude=node_modules --exclude=data .; fi")
    sftp = ssh.open_sftp()
    try:
      upload_dir(sftp, ssh, LOCAL_GATEWAY, REMOTE_GATEWAY)
    finally:
      sftp.close()
    backend_deploy.run(ssh, f"cd '{REMOTE_GATEWAY}' && npm install --production 2>&1", timeout=180)
    gateway_env = backend_deploy.remote_env_prefix()
    backend_deploy.run(
      ssh,
      f"cd '{REMOTE_GATEWAY}' && {gateway_env} pm2 restart {SERVICE_NAME} --update-env 2>&1 "
      f"|| ({gateway_env} pm2 start src/app.js --name {SERVICE_NAME})",
      timeout=120,
    )
    backend_deploy.run(ssh, "pm2 save", timeout=60)
    backend_deploy.run(ssh, "curl -s http://localhost:3001/api/health || echo 'gateway health check failed'", timeout=30)
  finally:
    ssh.close()


if __name__ == "__main__":
  main()
