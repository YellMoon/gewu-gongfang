import importlib.util
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "nginx_scheduling_retirement",
    Path(__file__).with_name("deploy_nginx_scheduling_retirement.py"),
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


SOURCE = """server {
    listen 80;
    location /cloud-business/ {
        proxy_pass http://127.0.0.1:3002/;
    }
}
server {
    listen 443 ssl;
    location /scheduling/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
    }
    location /cloud-business/ {
        proxy_pass http://127.0.0.1:3002/;
    }
}
"""

patched = MODULE.patch_nginx_config(SOURCE)
_start, _end, https_server = MODULE._https_server(patched)
scheduling = MODULE._location_match(https_server, "/scheduling/").group(0)
cloud_business = MODULE._location_match(https_server, "/cloud-business/").group(0)
assert "proxy_pass http://127.0.0.1:3001/;" in scheduling
assert "proxy_pass http://127.0.0.1:3002/;" not in scheduling
assert "proxy_pass http://127.0.0.1:3002/;" in cloud_business
assert "proxy_set_header Upgrade $http_upgrade;" in scheduling
assert MODULE.patch_nginx_config(patched) == patched
assert MODULE.EXPECTED_GATEWAY_VERSION == "8.9.1"

https_start = SOURCE.index("server {\n    listen 443 ssl;")
for invalid in (
    SOURCE.replace("location /scheduling/", "location /other/", 1),
    SOURCE.replace(
        "location /cloud-business/ {",
        "location /scheduling/ {\n        proxy_pass http://127.0.0.1:3002/;\n    }\n    location /cloud-business/ {",
    ),
    SOURCE.replace("http://127.0.0.1:3002/;", "http://127.0.0.1:3999/;", 2),
    SOURCE + "\n" + SOURCE[https_start:],
):
    try:
        MODULE.patch_nginx_config(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid nginx routing was accepted")

source_text = Path(MODULE.__file__).read_text(encoding="utf-8")
assert "cp --preserve=all" in source_text
assert "nginx -t && systemctl reload nginx" in source_text
assert "NGINX_SCHEDULING_RETIREMENT_TOMBSTONE_INVALID" in source_text
assert "NGINX_SCHEDULING_RETIREMENT_WEBSOCKET_INVALID" in source_text
assert "cp --preserve=all {quote(backup_path)} {quote(LIVE_PATH)}" in source_text

print("nginx scheduling retirement deployment checks passed")
