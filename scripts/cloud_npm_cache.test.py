import pathlib
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy_cloud_business_api as release


def stream(value, status=0):
    result = Mock()
    result.read.return_value = value.encode("utf-8")
    result.channel.recv_exit_status.return_value = status
    return result


class NpmCacheTests(unittest.TestCase):
    def test_only_matching_running_immutable_image_can_supply_cache(self):
        image = "gewu-cloud-business-api:8.17.1-abcdef123456"
        digest = "sha256:" + "a" * 64
        ssh = Mock()
        ssh.exec_command.side_effect = [(None, stream(image + " " + digest), None), (None, stream(digest), None)]
        self.assertEqual(release.verified_npm_cache_image(ssh), image)
        self.assertEqual(ssh.exec_command.call_count, 2)

    def test_retagged_mutable_malformed_or_unavailable_images_are_rejected(self):
        for value in ["gewu-cloud-business-api:latest sha256:" + "a" * 64, "evil:tag sha256:" + "a" * 64, "bad' injected", ""]:
            ssh = Mock()
            ssh.exec_command.return_value = (None, stream(value), None)
            self.assertIsNone(release.verified_npm_cache_image(ssh))
        ssh = Mock()
        ssh.exec_command.side_effect = [(None, stream("gewu-cloud-business-api:8.17.1-abcdef1 sha256:" + "a" * 64), None), (None, stream("sha256:" + "b" * 64), None)]
        self.assertIsNone(release.verified_npm_cache_image(ssh))
        ssh.exec_command.side_effect = OSError("unavailable")
        self.assertIsNone(release.verified_npm_cache_image(ssh))

    def test_build_only_passes_validated_cache_and_retains_canonical_install(self):
        with patch.object(release, "verified_npm_cache_image", return_value="gewu-cloud-business-api:8.17.1-abcdef1"), patch.object(release.deploy, "run") as run:
            release.build_image(Mock(), "8.18.0-abcdef2")
            command = run.call_args.args[1]
            self.assertIn("--build-arg 'NPM_CACHE_IMAGE=gewu-cloud-business-api:8.17.1-abcdef1'", command)
            self.assertIn("-f cloud-business-api/Dockerfile .", command)
        dockerfile = (ROOT / "cloud-business-api" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY --from=npm-cache /root/.npm /root/.npm", dockerfile)
        self.assertIn("npm install --omit=dev --ignore-scripts --prefer-offline", dockerfile)
        self.assertNotIn("COPY --from=npm-cache /app", dockerfile)


if __name__ == "__main__":
    unittest.main()
