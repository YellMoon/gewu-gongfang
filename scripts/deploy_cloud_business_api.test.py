import unittest

from deploy_cloud_business_api import candidate_command, candidate_name, release_tag, switch_command


class CloudBusinessDockerDeployTests(unittest.TestCase):
    def test_release_tag_is_stable_and_rejects_unsafe_input(self):
        self.assertEqual(release_tag("8.1.0", "8c425eab"), "8.1.0-8c425eab")
        with self.assertRaisesRegex(ValueError, "CLOUD_DOCKER_DEPLOY_CONFIG_INVALID"):
            release_tag("8.1.0;rm", "8c425eab")

    def test_candidate_name_uses_the_release_tag(self):
        self.assertEqual(candidate_name("8.1.0-8c425eab"), "gewu-cloud-business-api-candidate-8.1.0-8c425eab")

    def test_candidate_health_waits_for_startup(self):
        command = candidate_command("8.1.0-8c425eab")
        self.assertIn("for attempt in 1 2 3 4 5 6 7 8 9 10", command)
        self.assertIn("sleep 1", command)

    def test_switch_command_keeps_a_rollback_container_and_recovers_on_health_failure(self):
        command = switch_command("8.1.0-8c425eab")
        self.assertIn("rollback-8.1.0-8c425eab", command)
        self.assertIn("127.0.0.1:3002:3002", command)
        self.assertIn("curl --fail --silent --show-error --max-time 30 http://127.0.0.1:3002/api/health", command)
        self.assertIn("docker rename \"$rollback\" \"$current\"", command)
        self.assertNotIn("docker image prune", command)


if __name__ == "__main__":
    unittest.main()
