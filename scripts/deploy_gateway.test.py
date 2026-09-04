import json
import importlib.util
import unittest
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).with_name("deploy_gateway.py")
SPEC = importlib.util.spec_from_file_location("deploy_gateway_under_test", MODULE_PATH)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
VERSION = module.source_version()


class DeployRetiredGatewayTests(unittest.TestCase):
    def test_gateway_version_is_the_cloud_business_component_version(self):
        expected = json.loads(
            (Path(__file__).resolve().parents[1] / "cloud-business-api" / "package.json").read_text(encoding="utf-8")
        )["version"]
        gateway = json.loads(
            (Path(__file__).resolve().parents[1] / "gateway" / "package.json").read_text(encoding="utf-8")
        )["version"]
        self.assertEqual(module.source_version(), expected)
        self.assertEqual(gateway, expected)

    def test_restart_injects_only_the_public_cloud_component_version(self):
        ssh = mock.Mock()
        with mock.patch.object(module.backend_deploy, "run", return_value=("", "")) as run, mock.patch.object(
            module.backend_deploy,
            "run_with_remote_env",
            side_effect=AssertionError("retired gateway must not receive backend authority secrets"),
        ):
            module.restart_gateway(ssh)
        command = run.call_args.args[1]
        self.assertIn(f"GEWU_APP_VERSION={VERSION}", command)
        self.assertIn("pm2 start src/app.js --name edu-gateway --update-env", command)
        self.assertNotIn("BACKEND_JWT_SECRET", command)

    def test_retirement_verification_requires_health_and_every_tombstone(self):
        ssh = mock.Mock()
        responses = [
            (json.dumps({"ok": True, "version": VERSION, "legacyAuthority": "retired"}), ""),
            ("410", ""),
            ("410", ""),
            ("410", ""),
            ("410", ""),
        ]
        with mock.patch.object(module.backend_deploy, "run", side_effect=responses) as run:
            health = module.verify_retired_gateway(ssh, VERSION)
        self.assertEqual(health["legacyAuthority"], "retired")
        commands = [call.args[1] for call in run.call_args_list]
        for route in ("/api/cloud/commands", "/api/auth/login", "/api/admin/users", "/api/permissions/my"):
            self.assertTrue(any(route in command for command in commands), route)

    def test_retirement_verification_fails_closed_on_old_runtime(self):
        ssh = mock.Mock()
        with mock.patch.object(
            module.backend_deploy,
            "run",
            return_value=(json.dumps({"ok": True, "version": VERSION}), ""),
        ):
            with self.assertRaisesRegex(RuntimeError, "GATEWAY_RETIREMENT_HEALTH_INVALID"):
                module.verify_retired_gateway(ssh, VERSION)

    def test_deploy_is_a_cloud_business_subcomponent_without_its_own_receipt(self):
        ssh = mock.Mock()
        sftp = mock.Mock()
        ssh.open_sftp.return_value = sftp
        with mock.patch.object(module.backend_deploy, "require_release_manifest") as require_manifest, mock.patch.object(
            module.backend_deploy, "connect", return_value=ssh
        ), mock.patch.object(module.backend_deploy, "run", return_value=("", "")) as run, mock.patch.object(
            module, "upload_dir"
        ) as upload_dir, mock.patch.object(module, "stop_legacy_gateway_services"), mock.patch.object(
            module, "restart_gateway"
        ), mock.patch.object(module.backend_deploy, "wait_for_remote_health"), mock.patch.object(
            module, "verify_retired_gateway", return_value={"ok": True}
        ), mock.patch.object(module.backend_deploy, "record_release_receipt") as receipt:
            module.deploy_retired_gateway()
        require_manifest.assert_called_once_with("cloud_business")
        upload_dir.assert_called_once()
        install_call = next(call for call in run.call_args_list if "npm install --production" in call.args[1])
        self.assertGreaterEqual(install_call.kwargs.get("timeout", 0), 600)
        receipt.assert_not_called()
        sftp.close.assert_called_once()
        ssh.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
