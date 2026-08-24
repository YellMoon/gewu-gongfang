import unittest
from unittest import mock

import deploy_cloud_business_api as module
from deploy_cloud_business_api import (
    candidate_command,
    candidate_name,
    promotion_lock_acquire_command,
    promotion_lock_release_command,
    promotion_lock_stale_probe_command,
    reconcile_switch_failure_command,
    release_tag,
    rollback_command,
    switch_command,
)


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
        self.assertIn("flock -x 9", command)
        self.assertIn("rollback-8.1.0-8c425eab", command)
        self.assertIn("127.0.0.1:3002:3002", command)
        self.assertIn("curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3002/api/health", command)
        self.assertIn("for attempt in 1 2 3 4 5 6 7 8 9 10", command)
        self.assertIn("docker rename \"$rollback\" \"$current\"", command)
        self.assertNotIn("docker image prune", command)
        self.assertLess(
            command.index('docker rename "$current" "$rollback"'),
            command.index('docker stop "$rollback"'),
            "the rollback marker must exist before the old service is stopped",
        )

    def test_promote_reuses_only_a_validated_candidate_tag(self):
        with self.assertRaisesRegex(ValueError, "CLOUD_DOCKER_DEPLOY_CONFIG_INVALID"):
            switch_command("8.3.0-current;id")

    def test_candidate_tag_must_match_the_checked_out_source(self):
        with mock.patch.object(module, "source_version", return_value="8.5.0"), mock.patch.object(
            module, "source_revision", return_value="1101687f349d"
        ):
            self.assertEqual(module.validated_release_tag(), "8.5.0-1101687f349d")
            with self.assertRaisesRegex(ValueError, "CLOUD_DOCKER_DEPLOY_CONFIG_INVALID"):
                module.validated_release_tag("8.5.0-deadbee")

    def test_explicit_rollback_restores_the_preserved_container(self):
        command = rollback_command("8.5.0-1101687f349d")
        self.assertIn("rollback-8.5.0-1101687f349d", command)
        self.assertIn('docker rm -f "$current"', command)
        self.assertIn('docker rename "$rollback" "$current"', command)
        self.assertIn("127.0.0.1:3002/api/health", command)
        self.assertIn("flock -x 9", command)

    def test_uncertain_switch_reconciliation_serializes_and_restores_if_needed(self):
        command = reconcile_switch_failure_command("8.5.0-b195691c27e9")
        self.assertIn("flock -x 9", command)
        self.assertIn('if docker container inspect "$rollback"', command)
        self.assertIn('docker rename "$rollback" "$current"', command)
        self.assertIn('docker container inspect "$current"', command)
        self.assertIn("{{.State.Running}}", command)
        self.assertIn('docker start "$current"', command)
        self.assertIn("127.0.0.1:3002/api/health", command)

    def test_discard_targets_only_the_exact_candidate(self):
        self.assertEqual(
            module.discard_candidate_command("8.4.1-881fe92c01ff"),
            "docker rm -f -- 'gewu-cloud-business-api-candidate-8.4.1-881fe92c01ff'",
        )

    def test_promotion_lock_is_atomic_owned_and_records_recovery_metadata(self):
        operation_id = "a" * 32
        tag = "8.5.0-8a40b41050be"
        acquire = promotion_lock_acquire_command(operation_id, tag)
        release = promotion_lock_release_command(operation_id)
        probe = promotion_lock_stale_probe_command(tag)
        self.assertIn('ln "$tmp" "$lock"', acquire)
        self.assertIn("$(date +%s)", acquire)
        self.assertIn(operation_id, acquire)
        self.assertIn(tag, acquire)
        self.assertIn('test "$actual_owner" = "$owner"', release)
        self.assertIn("age=$((now - created))", probe)
        self.assertIn(str(module.PROMOTION_LOCK_STALE_SECONDS), probe)

    def test_stale_lock_recovery_requires_explicit_mode_and_verification(self):
        stale = {"operationId": "c" * 32, "ageSeconds": 901}
        with mock.patch.object(module, "read_stale_promotion_lock", return_value=stale), mock.patch.object(
            module, "reconcile_uncertain_switch"
        ) as reconcile, mock.patch.object(module, "verify_public_health") as verify, mock.patch.object(
            module, "verify_current_release_tag"
        ) as verify_tag, mock.patch.object(
            module, "release_promotion_lock"
        ) as release:
            result = module.recover_promotion_lock("8.5.0-8a40b41050be", "rollback")
        reconcile.assert_called_once_with("8.5.0-8a40b41050be")
        verify.assert_not_called()
        verify_tag.assert_not_called()
        release.assert_called_once_with("c" * 32)
        self.assertEqual(result["ageSeconds"], 901)

        with mock.patch.object(module, "read_stale_promotion_lock", return_value=stale), mock.patch.object(
            module, "reconcile_uncertain_switch"
        ) as reconcile, mock.patch.object(module, "verify_public_health", return_value={"ok": True}) as verify, mock.patch.object(
            module, "verify_current_release_tag"
        ) as verify_tag, mock.patch.object(
            module, "release_promotion_lock"
        ) as release:
            module.recover_promotion_lock("8.5.0-8a40b41050be", "preserve")
        reconcile.assert_not_called()
        verify_tag.assert_called_once_with("8.5.0-8a40b41050be")
        verify.assert_called_once_with("8.5.0")
        release.assert_called_once_with("c" * 32)

    def test_complete_promotion_lifecycle_holds_one_operation_lock(self):
        health = {"ok": True, "businessAuthority": "cloud", "version": "8.5.0"}
        with mock.patch.object(module.secrets, "token_hex", return_value="b" * 32), mock.patch.object(
            module, "acquire_promotion_lock"
        ) as acquire, mock.patch.object(module, "release_promotion_lock") as release, mock.patch.object(
            module, "promote_candidate_under_lock", return_value=health
        ) as promote:
            self.assertEqual(module.promote_validated_candidate("8.5.0-980f2c842eab", "8.5.0", "evidence"), health)
        acquire.assert_called_once_with("b" * 32, "8.5.0-980f2c842eab")
        promote.assert_called_once_with("8.5.0-980f2c842eab", "8.5.0", "evidence")
        release.assert_called_once_with("b" * 32)

    def test_cloud_migrations_apply_control_plane_before_business_schema(self):
        with mock.patch.object(module.subprocess, "run") as run:
            run.return_value.returncode = 0
            self.assertEqual(module.run_cloud_migrations(), 0)
        self.assertEqual(len(run.call_args_list), 4)
        self.assertTrue(str(run.call_args_list[0].args[0][1]).endswith("apply_cloud_control_plane_m20.py"))
        self.assertTrue(str(run.call_args_list[1].args[0][1]).endswith("apply_cloud_control_plane_m21.py"))
        self.assertTrue(str(run.call_args_list[2].args[0][1]).endswith("apply_cloud_control_plane_m22.py"))
        self.assertTrue(str(run.call_args_list[3].args[0][1]).endswith("apply_cloud_postgres_migrations.py"))

    def test_public_health_requires_the_exact_release_version(self):
        ssh = mock.Mock()
        with mock.patch.object(module.deploy, "connect", return_value=ssh), mock.patch.object(
            module.deploy,
            "run",
            return_value=(' {"ok":true,"businessAuthority":"cloud","version":"8.4.1"} ', ""),
        ):
            with self.assertRaisesRegex(RuntimeError, "CLOUD_DOCKER_DEPLOY_HEALTH_INVALID"):
                module.verify_public_health("8.5.0")
        ssh.close.assert_called_once()

    def test_deploy_release_requires_manifest_and_records_verified_receipt(self):
        ssh = mock.Mock()
        health = {"ok": True, "businessAuthority": "cloud", "version": "8.5.0"}
        with mock.patch.object(module, "source_version", return_value="8.5.0"), mock.patch.object(
            module, "source_revision", return_value="1165783d"
        ), mock.patch.object(module.deploy, "require_release_manifest") as require_manifest, mock.patch.object(
            module.deploy, "record_release_receipt"
        ) as record_receipt, mock.patch.object(module.deploy, "connect", return_value=ssh), mock.patch.object(
            module, "upload_source"
        ), mock.patch.object(module, "build_image"), mock.patch.object(
            module.deploy, "run"
        ), mock.patch.object(module, "run_cloud_migrations", return_value=0), mock.patch.object(
            module, "verify_public_health", return_value=health
        ) as verify_health, mock.patch.object(
            module, "acquire_promotion_lock", return_value=mock.Mock()
        ), mock.patch.object(
            module, "release_promotion_lock"
        ):
            self.assertEqual(module.deploy_release(), health)
        require_manifest.assert_called_once_with("cloud_business")
        verify_health.assert_called_once_with("8.5.0")
        record_receipt.assert_called_once()
        self.assertEqual(record_receipt.call_args.args[0], "cloud_business")
        self.assertIn("8.5.0", record_receipt.call_args.args[1])

    def test_public_health_failure_rolls_back_and_skips_receipt(self):
        switch_ssh = mock.Mock()
        rollback_ssh = mock.Mock()
        with mock.patch.object(module, "acquire_promotion_lock", return_value=mock.Mock()), mock.patch.object(
            module, "release_promotion_lock"
        ), mock.patch.object(
            module.deploy, "connect", side_effect=[switch_ssh, rollback_ssh]
        ), mock.patch.object(
            module.deploy, "run"
        ) as run, mock.patch.object(
            module, "verify_public_health", side_effect=RuntimeError("CLOUD_DOCKER_DEPLOY_HEALTH_INVALID")
        ), mock.patch.object(module.deploy, "record_release_receipt") as record_receipt:
            with self.assertRaisesRegex(RuntimeError, "CLOUD_DOCKER_DEPLOY_HEALTH_INVALID"):
                module.promote_validated_candidate("8.5.0-1101687f349d", "8.5.0", "evidence")
        self.assertEqual(run.call_count, 2)
        self.assertIn("rollback-8.5.0-1101687f349d", run.call_args_list[1].args[1])
        record_receipt.assert_not_called()
        switch_ssh.close.assert_called_once()
        rollback_ssh.close.assert_called_once()

    def test_receipt_failure_rolls_back_the_switched_release(self):
        switch_ssh = mock.Mock()
        rollback_ssh = mock.Mock()
        with mock.patch.object(module, "acquire_promotion_lock", return_value=mock.Mock()), mock.patch.object(
            module, "release_promotion_lock"
        ), mock.patch.object(
            module.deploy, "connect", side_effect=[switch_ssh, rollback_ssh]
        ), mock.patch.object(
            module.deploy, "run"
        ) as run, mock.patch.object(
            module, "verify_public_health", return_value={"ok": True, "version": "8.5.0"}
        ), mock.patch.object(
            module.deploy, "record_release_receipt", side_effect=OSError("receipt write failed")
        ):
            with self.assertRaisesRegex(OSError, "receipt write failed"):
                module.promote_validated_candidate("8.5.0-1101687f349d", "8.5.0", "evidence")
        self.assertEqual(run.call_count, 2)
        self.assertIn("rollback-8.5.0-1101687f349d", run.call_args_list[1].args[1])

    def test_switch_transport_failure_reconnects_and_reconciles_before_returning_failure(self):
        switch_ssh = mock.Mock()
        reconcile_ssh = mock.Mock()
        with mock.patch.object(module, "acquire_promotion_lock", return_value=mock.Mock()), mock.patch.object(
            module, "release_promotion_lock"
        ), mock.patch.object(
            module.deploy, "connect", side_effect=[switch_ssh, reconcile_ssh]
        ), mock.patch.object(
            module.deploy, "run", side_effect=[TimeoutError("ssh timeout"), ("healthy", "")]
        ) as run, mock.patch.object(module, "verify_public_health") as verify_health, mock.patch.object(
            module.deploy, "record_release_receipt"
        ) as record_receipt:
            with self.assertRaisesRegex(TimeoutError, "ssh timeout"):
                module.promote_validated_candidate("8.5.0-b195691c27e9", "8.5.0", "evidence")
        self.assertEqual(run.call_count, 2)
        self.assertIn("flock -x 9", run.call_args_list[0].args[1])
        self.assertIn("rollback-8.5.0-b195691c27e9", run.call_args_list[1].args[1])
        verify_health.assert_not_called()
        record_receipt.assert_not_called()
        switch_ssh.close.assert_called_once()
        reconcile_ssh.close.assert_called_once()

    def test_promote_rejects_a_candidate_from_another_source_revision(self):
        with mock.patch.object(module, "source_version", return_value="8.5.0"), mock.patch.object(
            module, "source_revision", return_value="1165783d"
        ):
            with self.assertRaisesRegex(ValueError, "CLOUD_DOCKER_DEPLOY_CONFIG_INVALID"):
                module.promote_release("8.5.0-deadbee")


if __name__ == "__main__":
    unittest.main()
