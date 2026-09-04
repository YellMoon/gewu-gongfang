"""Deploy the retired compatibility gateway as part of the cloud component."""
import importlib.util
import json
import re
import shlex
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL_GATEWAY = ROOT / "gateway"
REMOTE_GATEWAY = "/root/education-platform/gateway"
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


def source_version():
  payload = json.loads((ROOT / "cloud-business-api" / "package.json").read_text(encoding="utf-8"))
  version = payload.get("version")
  if not isinstance(version, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2}", version):
    raise RuntimeError("GATEWAY_CLOUD_COMPONENT_VERSION_INVALID")
  return version


def restart_gateway(ssh, path_factory=None):
  del path_factory
  version = shlex.quote(source_version())
  command = (
    f"cd '{REMOTE_GATEWAY}' && "
    f"pm2 delete {SERVICE_NAME} 2>/dev/null || true; "
    f"GEWU_APP_VERSION={version} pm2 start src/app.js --name {SERVICE_NAME} --update-env"
  )
  return backend_deploy.run(ssh, command, timeout=120)


def stop_legacy_gateway_services(ssh):
  for service_name in LEGACY_SERVICE_NAMES:
    backend_deploy.run(ssh, f"pm2 stop {service_name} 2>/dev/null || true")
    backend_deploy.run(ssh, f"pm2 delete {service_name} 2>/dev/null || true")


def verify_retired_gateway(ssh, expected_version):
  if expected_version != source_version():
    raise RuntimeError("GATEWAY_CLOUD_COMPONENT_VERSION_INVALID")
  output, _ = backend_deploy.run(
    ssh,
    "curl --fail --silent --show-error --max-time 30 http://127.0.0.1:3001/api/health",
    timeout=45,
  )
  try:
    payload = json.loads(output)
  except json.JSONDecodeError as error:
    raise RuntimeError("GATEWAY_RETIREMENT_HEALTH_INVALID") from error
  if (payload.get("ok") is not True
      or payload.get("version") != expected_version
      or payload.get("legacyAuthority") != "retired"):
    raise RuntimeError("GATEWAY_RETIREMENT_HEALTH_INVALID")
  for route in (
      "/api/cloud/commands",
      "/api/auth/login",
      "/api/admin/users",
      "/api/permissions/my",
  ):
    status, _ = backend_deploy.run(
      ssh,
      f"curl --silent --output /dev/null --write-out '%{{http_code}}' --max-time 30 "
      f"http://127.0.0.1:3001{route}",
      timeout=45,
    )
    if status.strip() != "410":
      raise RuntimeError("GATEWAY_RETIREMENT_TOMBSTONE_INVALID")
  return payload


def deploy_retired_gateway():
  backend_deploy.require_release_manifest("cloud_business")
  expected_version = source_version()
  ssh = backend_deploy.connect()
  try:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backups/gateway/{stamp}"
    backend_deploy.run(ssh, f"mkdir -p '{backup_dir}'")
    backend_deploy.run(ssh, f"if [ -d '{REMOTE_GATEWAY}' ]; then tar -C '{REMOTE_GATEWAY}' -czf '{backup_dir}/gateway-code.tar.gz' --exclude=node_modules --exclude=data .; fi")
    sftp = ssh.open_sftp()
    try:
      upload_dir(sftp, ssh, LOCAL_GATEWAY, REMOTE_GATEWAY)
    finally:
      sftp.close()
    backend_deploy.run(ssh, f"cd '{REMOTE_GATEWAY}' && npm install --production 2>&1", timeout=180)
    stop_legacy_gateway_services(ssh)
    restart_gateway(ssh)
    backend_deploy.run(ssh, "pm2 save", timeout=60)
    backend_deploy.wait_for_remote_health(
      ssh,
      3001,
      "gateway",
      expected_version,
      attempts=12,
      delay_seconds=1,
    )
    return verify_retired_gateway(ssh, expected_version)
  finally:
    ssh.close()


def main():
  deploy_retired_gateway()


if __name__ == "__main__":
  main()
