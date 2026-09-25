import argparse
import hashlib
import tempfile
import unittest
from pathlib import Path

import deploy_nas_storage_agent as subject


class DeployNasStorageAgentTests(unittest.TestCase):
    def test_release_inputs_reject_shell_metacharacters(self):
        self.assertEqual(subject.require_version("8.5.0"), "8.5.0")
        self.assertEqual(subject.require_container("gewu-storage-agent-8.5.0"), "gewu-storage-agent-8.5.0")
        with self.assertRaises(subject.DeployError):
            subject.require_version("8.5.0; rm -rf /")
        with self.assertRaises(subject.DeployError):
            subject.require_container("agent $(id)")
        with self.assertRaises(subject.DeployError):
            subject.require_absolute_path("/nas-storage;id")

    def test_artifact_details_hashes_a_real_tarball(self):
        with tempfile.TemporaryDirectory() as temp:
            artifact = Path(temp) / "agent.tar"
            artifact.write_bytes(b"storage-agent-image")
            path, digest = subject.artifact_details(str(artifact))
            self.assertEqual(path, artifact.resolve())
            self.assertEqual(digest, hashlib.sha256(b"storage-agent-image").hexdigest())

    def test_gui_release_card_has_no_remote_authentication_workflow(self):
        with tempfile.TemporaryDirectory() as temp:
            artifact = Path(temp) / "agent.tar"
            artifact.write_bytes(b"storage-agent-image")
            plan = subject.gui_release_plan(argparse.Namespace(
                version="8.5.0", image=None, artifact=str(artifact), container=None,
                previous_container="gewu-storage-agent-8.4.1", mount_target="/nas-storage",
                config_path="/nas-storage/agent.env",
            ))
        rendered = str(plan).lower()
        self.assertEqual(plan["workflow"], "classic-ugos-docker-ui")
        self.assertEqual(plan["newContainer"], "gewu-storage-agent-8.5.0")
        self.assertEqual(plan["healthCommand"], "node src/healthCli.js /nas-storage/agent.env")
        self.assertIn("stop gewu-storage-agent-8.5.0", plan["rollback"])
        self.assertNotIn("ssh", rendered)
        self.assertNotIn("password", rendered)
        self.assertNotIn("private-key", rendered)

    def test_plan_refuses_missing_or_non_tar_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(subject.DeployError):
                subject.artifact_details(str(Path(temp) / "missing.tar"))
            non_tar = Path(temp) / "agent.zip"
            non_tar.write_bytes(b"not-a-tar")
            with self.assertRaises(subject.DeployError):
                subject.artifact_details(str(non_tar))


if __name__ == "__main__":
    unittest.main()
