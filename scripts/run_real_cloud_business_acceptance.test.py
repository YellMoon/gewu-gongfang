import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "run_real_cloud_business_acceptance.py"


def load_module():
    spec = importlib.util.spec_from_file_location("real_cloud_acceptance_runner", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_paths_and_commands_are_exact_and_nonrecursive():
    module = load_module()
    assert module.REMOTE_SCRIPT == "/tmp/gewu-real-cloud-business-acceptance.js"
    assert module.CONTAINER_SCRIPT == "/app/real-cloud-business-acceptance.js"
    assert module.CONTAINER == "gewu-cloud-business-api"
    commands = "\n".join([
        module.remote_preflight_command(),
        module.container_preflight_command(),
        module.copy_command(),
        module.grant_owner_command(),
        module.revoke_owner_command(),
        module.execute_command(),
        module.cleanup_command(),
    ])
    assert "rm -rf" not in commands
    assert "docker rm" not in commands
    assert "docker stop" not in commands
    assert "docker exec gewu-cloud-business-api node /app/real-cloud-business-acceptance.js" in commands
    assert module.grant_owner_command().endswith("-c 'GRANT vnext_pg17_owner, vnext_pg17_business_owner TO vnext_pg17_writer'")
    assert module.revoke_owner_command().endswith("-c 'REVOKE vnext_pg17_owner, vnext_pg17_business_owner FROM vnext_pg17_writer'")
    assert "docker exec -u 0 gewu-cloud-business-api rm -f -- /app/real-cloud-business-acceptance.js" in module.cleanup_command()
    assert module.CONTAINER_SCRIPT in module.cleanup_command()
    assert module.REMOTE_SCRIPT in module.cleanup_command()


def test_receipt_is_strict_and_contains_no_session_material():
    module = load_module()
    payload = {
        "ok": True,
        "version": "8.4.1",
        "createStatus": 201,
        "readBack": True,
        "updateStatus": 200,
        "staleConflictStatus": 409,
        "deleteStatus": 200,
        "absenceConfirmed": True,
        "cleanupConfirmed": True,
        "markerSha256": "a" * 64,
        "teachingLoopCreated": 7,
        "teachingLoopReadBack": True,
        "teachingLoopCourseUpdateStatus": 200,
        "teachingLoopCourseConflictStatus": 409,
        "teachingLoopCleanupConfirmed": True,
        "onlineRegistrationStatus": 200,
        "onlineSessionContextStatus": 200,
        "onlineRegistrationReplayed": False,
        "onlineReceiptSha256": "b" * 64,
        "miniappAssetImportStatus": 202,
        "miniappAssetReplayStatus": 200,
        "miniappAssetReadBack": True,
        "miniappAssetCleanupConfirmed": True,
    }
    assert module.parse_receipt(json.dumps(payload)) == payload
    for key in ("sessionToken", "token", "password", "phone"):
        bad = dict(payload)
        bad[key] = "secret"
        try:
            module.parse_receipt(json.dumps(bad))
        except ValueError as error:
            assert str(error) == "REAL_CLOUD_ACCEPTANCE_RECEIPT_INVALID"
        else:
            raise AssertionError(f"unexpected receipt key accepted: {key}")


def test_receipt_version_must_match_the_requested_release():
    module = load_module()
    payload = {
        "ok": True,
        "version": "8.4.1",
        "createStatus": 201,
        "readBack": True,
        "updateStatus": 200,
        "staleConflictStatus": 409,
        "deleteStatus": 200,
        "absenceConfirmed": True,
        "cleanupConfirmed": True,
        "markerSha256": "a" * 64,
        "teachingLoopCreated": 7,
        "teachingLoopReadBack": True,
        "teachingLoopCourseUpdateStatus": 200,
        "teachingLoopCourseConflictStatus": 409,
        "teachingLoopCleanupConfirmed": True,
        "onlineRegistrationStatus": 200,
        "onlineSessionContextStatus": 200,
        "onlineRegistrationReplayed": False,
        "onlineReceiptSha256": "b" * 64,
        "miniappAssetImportStatus": 202,
        "miniappAssetReplayStatus": 200,
        "miniappAssetReadBack": True,
        "miniappAssetCleanupConfirmed": True,
    }
    try:
        module.parse_receipt(json.dumps(payload), expected_version="8.4.2")
    except ValueError as error:
        assert str(error) == "REAL_CLOUD_ACCEPTANCE_VERSION_MISMATCH"
    else:
        raise AssertionError("stale acceptance receipt version was accepted")


if __name__ == "__main__":
    test_paths_and_commands_are_exact_and_nonrecursive()
    test_receipt_is_strict_and_contains_no_session_material()
    test_receipt_version_must_match_the_requested_release()
    print("real cloud business acceptance runner checks passed")
