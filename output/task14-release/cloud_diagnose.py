import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('gewu_deploy', ROOT / 'scripts' / 'deploy.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)

ssh = deploy.connect()
try:
    for command in [
        'pm2 status',
        'pm2 logs scheduling-backend-prod --lines 100 --nostream',
        'pm2 logs edu-gateway --lines 100 --nostream',
        "curl -i -sS --max-time 5 http://127.0.0.1:3002/api/health || true",
        "curl -i -sS --max-time 5 http://127.0.0.1:3001/api/health || true",
    ]:
        deploy.run(ssh, command, timeout=60)
finally:
    ssh.close()
