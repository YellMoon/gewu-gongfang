"""Create an append-only backup of the live Nginx configuration before release."""
from datetime import datetime, timezone
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def main():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/scheduling-backups/nginx/{stamp}"
    ssh = deploy.connect()
    try:
        deploy.run(ssh, f"mkdir -p '{backup_dir}'")
        deploy.run(ssh, f"cp -L /etc/nginx/sites-enabled/education-platform '{backup_dir}/education-platform.conf'")
        deploy.run(ssh, f"test -s '{backup_dir}/education-platform.conf'")
        deploy.run(ssh, "mkdir -p /root/scheduling-backups/nginx/latest-before-websocket")
        deploy.run(ssh, f"cp '{backup_dir}/education-platform.conf' /root/scheduling-backups/nginx/latest-before-websocket/education-platform.conf")
    finally:
        ssh.close()
    print(f"BACKUP_DIR={backup_dir}")


if __name__ == '__main__':
    main()
