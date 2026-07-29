import importlib.util
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("upload_miniapp_from_ecs.py")
SPEC = importlib.util.spec_from_file_location("upload_miniapp_from_ecs", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


layout = MODULE.build_remote_layout("release-20260730-test")
assert layout["root"] == "/root/.cache/gewu-miniapp-ci/release-20260730-test"
assert layout["key"] == "/root/.cache/gewu-miniapp-ci/release-20260730-test/.private-key"
assert layout["archive"] == "/root/.cache/gewu-miniapp-ci/release-20260730-test/source.tar.gz"
assert layout["log"] == "/root/.cache/gewu-miniapp-ci/release-20260730-test/upload.log"
assert layout["pid"] == "/root/.cache/gewu-miniapp-ci/release-20260730-test/upload.pid"
assert layout["root"].startswith("/root/.cache/gewu-miniapp-ci/release-")

command = MODULE.build_remote_upload_command(
    layout,
    version="7.0.0",
    desc="7.0.0 ECS upload",
    robot=1,
)
assert "npm ci --prefix miniapp --include=dev" in command
assert "npm --prefix miniapp run build:weapp" in command
assert "WECHAT_MINIAPP_PRIVATE_KEY_PATH=" in command
assert "node scripts/upload-miniapp.js" in command
assert "7.0.0" in command
assert "ECS upload" in command
assert ".private-key" in command

start_command = MODULE.build_remote_start_command(layout, command)
assert "nohup sh -lc" in start_command
assert "upload.log" in start_command
assert "upload.pid" in start_command
assert "& &&" not in start_command

assert MODULE.parse_remote_upload_state(True, "") == "running"
assert MODULE.parse_remote_upload_state(False, '{\"success\":true}') == "succeeded"
assert MODULE.parse_remote_upload_state(False, "upload failed") == "failed"

assert MODULE.is_uploadable_relative_path("miniapp/src/app.tsx")
assert not MODULE.is_uploadable_relative_path("miniapp/node_modules/ws/index.js")
assert not MODULE.is_uploadable_relative_path("miniapp/dist/app.js")
assert not MODULE.is_uploadable_relative_path(".git/config")
assert not MODULE.is_uploadable_relative_path("miniapp/project.private.config.json")

assert MODULE.safe_cleanup_command(layout["root"]) == "rm -rf -- /root/.cache/gewu-miniapp-ci/release-20260730-test"
try:
    MODULE.safe_cleanup_command("/root")
except ValueError as error:
    assert str(error) == "ECS_UPLOAD_CLEANUP_PATH_INVALID"
else:
    raise AssertionError("cleanup must reject a broad remote path")

print("ECS miniapp upload checks passed")
