import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import deploy_nas_storage_agent as subject


class DeployNasStorageAgentTests(unittest.TestCase):
    def test_validate_release_inputs_rejects_shell_metacharacters(self):
        self.assertEqual(subject.require_version("8.5.0"), "8.5.0")
        self.assertEqual(subject.require_container_name("gewu-storage-agent-8.5.0"), "gewu-storage-agent-8.5.0")
        with self.assertRaises(subject.DeployError):
            subject.require_version("8.5.0; rm -rf /")
        with self.assertRaises(subject.DeployError):
            subject.require_container_name("agent $(id)")
        with self.assertRaises(subject.DeployError):
            subject.require_mount_source("/volume1/Gewu Storage")

    def test_artifact_digest_and_remote_path_are_content_addressed(self):
        with tempfile.TemporaryDirectory() as temp:
            artifact = Path(temp) / "agent.tar"
            artifact.write_bytes(b"storage-agent-image")
            digest = subject.sha256_file(artifact)
            self.assertEqual(digest, hashlib.sha256(b"storage-agent-image").hexdigest())
            self.assertEqual(
                subject.remote_artifact_path(digest),
                f"/tmp/gewu-storage-agent/{digest}.tar",
            )

    def test_keypair_creation_writes_an_openssh_public_key(self):
        with tempfile.TemporaryDirectory() as temp:
            private_path, public_path = subject.ensure_keypair(Path(temp) / "id_ed25519")
            self.assertTrue(private_path.is_file())
            if os.name != "nt":
                self.assertEqual(private_path.stat().st_mode & 0o777, 0o600)
            self.assertTrue(subject.read_public_key(public_path).startswith("ssh-ed25519 "))
            self.assertEqual(subject.ensure_keypair(private_path), (private_path, public_path))

    def test_deployment_commands_keep_existing_container_as_rollback_candidate(self):
        commands = subject.deployment_commands(
            image="gewu-storage-agent:8.5.0",
            candidate_container="gewu-storage-agent-8.5.0",
            previous_container="gewu-storage-agent-8.4.1",
            mount_source="/volume1/GewuStorageAgent",
            mount_target="/nas-storage",
            network="bridge",
            restart_policy="unless-stopped",
            config_path="/nas-storage/agent.env",
            version="8.5.0",
        )
        self.assertIn("docker create --name gewu-storage-agent-8.5.0", commands["create"])
        self.assertIn("-v /volume1/GewuStorageAgent:/nas-storage:rw", commands["create"])
        self.assertIn("docker stop gewu-storage-agent-8.4.1", commands["stop_previous"])
        self.assertIn("docker start gewu-storage-agent-8.5.0", commands["start_candidate"])
        self.assertIn("node src/healthCli.js /nas-storage/agent.env", commands["health"])
        self.assertIn("docker start gewu-storage-agent-8.4.1", commands["rollback"])
        self.assertNotIn("docker rm", "\n".join(commands.values()))

    def test_inspection_commands_report_only_container_runtime_facts(self):
        commands = subject.container_inspection_commands("gewu-storage-agent-8.4.1")
        self.assertEqual(
            commands["mounts"],
            "docker inspect --format '{{json .Mounts}}' gewu-storage-agent-8.4.1",
        )
        self.assertIn(".Config.Image", commands["image"])
        self.assertIn(".State.Running", commands["running"])
        self.assertIn(".HostConfig.NetworkMode", commands["network"])
        self.assertIn(".HostConfig.RestartPolicy.Name", commands["restartPolicy"])
        self.assertNotIn(".Config.Env", "\n".join(commands.values()))

    def test_publish_authorized_key_is_idempotent_and_does_not_send_password_to_shell(self):
        key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEbKq0pV4qRwlAJI2HgCShV85f2DAwXxJP0Sr6z9De2 gewu-nas-deploy"
        command = subject.authorized_key_command(key)
        self.assertIn("grep -qxF", command)
        self.assertIn("authorized_keys", command)
        self.assertNotIn("password", command.lower())

    def test_checked_connect_refuses_unexpected_host_key_before_authentication(self):
        fake_key = mock.Mock()
        fake_key.get_name.return_value = "ssh-ed25519"
        fake_key.asbytes.return_value = b"different"
        with mock.patch.object(subject, "read_host_key", return_value=fake_key):
            with self.assertRaises(subject.DeployError):
                subject.assert_host_key_fingerprint("192.168.1.2", 22, "SHA256:not-the-real-key")


if __name__ == "__main__":
    unittest.main()
