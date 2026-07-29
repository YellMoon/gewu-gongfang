"""Read only the active Nginx scheduling proxy definition from the production host."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def main():
    ssh = deploy.connect()
    try:
        deploy.run(ssh, "systemctl is-active nginx")
        deploy.run(ssh, "nginx -T 2>&1 | sed -n '197,240p'")
        deploy.run(ssh, "ss -ltnp | grep -E ':(3001|3002)\\b' || true")
        deploy.run(ssh, "curl -sS --max-time 5 http://127.0.0.1:3001/api/health || true")
        deploy.run(ssh, "curl -sS --max-time 5 http://127.0.0.1:3002/api/health || true")
        deploy.run(ssh, "pm2 ls")
    finally:
        ssh.close()


if __name__ == '__main__':
    main()
