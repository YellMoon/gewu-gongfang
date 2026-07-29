"""Safely enable WebSocket Upgrade forwarding for the live gateway proxy."""
import base64
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("backend_deploy", ROOT / "scripts" / "deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

LIVE_PATH = "/etc/nginx/sites-enabled/education-platform"
BACKUP_PATH = "/root/scheduling-backups/nginx/latest-before-websocket/education-platform.conf"
NEEDLE = "proxy_pass http://127.0.0.1:3001;\n        proxy_set_header Host"
REPLACEMENT = (
    "proxy_pass http://127.0.0.1:3001;\n"
    "        proxy_http_version 1.1;\n"
    "        proxy_set_header Upgrade $http_upgrade;\n"
    "        proxy_set_header Connection \"upgrade\";\n"
    "        proxy_set_header Host"
)


def remote_python(source: str) -> str:
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    return f"python3 -c \"import base64;exec(base64.b64decode('{encoded}'))\""


def main():
    ssh = deploy.connect()
    try:
        deploy.run(ssh, "test -s /root/scheduling-backups/nginx/latest-before-websocket/education-platform.conf")
        source = f"""
from pathlib import Path
path = Path({LIVE_PATH!r})
text = path.read_text(encoding='utf-8')
needle = {NEEDLE!r}
replacement = {REPLACEMENT!r}
legacy_marker = 'proxy_set_header Connection ' + chr(92) + '"upgrade' + chr(92) + '";'
if replacement in text:
    print('NGINX_WEBSOCKET_PROXY_ALREADY_PRESENT')
elif legacy_marker in text:
    path.write_text(text.replace(legacy_marker, 'proxy_set_header Connection "upgrade";'), encoding='utf-8')
    print('NGINX_WEBSOCKET_PROXY_QUOTING_FIXED')
elif needle not in text:
    raise SystemExit('NGINX_GATEWAY_PROXY_PATTERN_NOT_FOUND')
else:
    path.write_text(text.replace(needle, replacement), encoding='utf-8')
    print('NGINX_WEBSOCKET_PROXY_UPDATED')
"""
        deploy.run(ssh, remote_python(source))
        try:
            deploy.run(ssh, "nginx -t", timeout=30)
            deploy.run(ssh, "systemctl reload nginx", timeout=30)
            deploy.run(ssh, "curl -fsS --max-time 10 https://physicsedu.xyz/scheduling/api/health >/dev/null")
        except Exception:
            deploy.run(ssh, f"cp '{BACKUP_PATH}' '{LIVE_PATH}'")
            deploy.run(ssh, "nginx -t && systemctl reload nginx", timeout=30)
            raise
    finally:
        ssh.close()


if __name__ == '__main__':
    main()
