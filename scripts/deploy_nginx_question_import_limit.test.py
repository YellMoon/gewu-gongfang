import importlib.util
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("nginx_limit", Path(__file__).with_name("deploy_nginx_question_import_limit.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

SOURCE = """server {
    location /scheduling/ {
        proxy_pass http://127.0.0.1:3002/;
    }
    location /cloud-business/ {
        proxy_pass http://127.0.0.1:3002/;
    }
}
"""
PATCHED = MODULE.patch_nginx_config(SOURCE)
assert PATCHED.count("client_max_body_size 96m;") == 2
assert MODULE.patch_nginx_config(PATCHED) == PATCHED
try:
    MODULE.patch_nginx_config("server { location / { return 404; } }")
except ValueError as error:
    assert str(error) == "NGINX_QUESTION_IMPORT_LOCATION_MISSING"
else:
    raise AssertionError("missing locations accepted")
print("nginx question import limit deployment checks passed")
