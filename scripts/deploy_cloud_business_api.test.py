import unittest
from unittest import mock

import deploy_cloud_business_api as module
from deploy_cloud_business_api import (
    candidate_command,
    candidate_name,
    cloud_runtime_overrides,
    promotion_lock_acquire_command,
    promotion_lock_heartbeat_command,
    promotion_lock_recovery_claim_command,
    promotion_lock_release_command,
    reconcile_switch_failure_command,
    release_tag,
    rollback_command,
    runtime_override_env_path,
    switch_command,
)

REAL_RUN_CLOUD_MIGRATIONS = module.run_cloud_migrations
REAL_CREATE_VERIFIED_BACKUP = module.create_verified_backup
VERIFIED_BACKUP = {
    "root": "/root/scheduling-backups/postgres/20260901-010203",
    "dump": "/root/scheduling-backups/postgres/20260901-010203/gewu_cloud.dump",
    "checksum": "/root/scheduling-backups/postgres/20260901-010203/gewu_cloud.dump.sha256",
    "metadata": "/root/scheduling-backups/postgres/20260901-010203/metadata.json",
    "sha256": "b" * 64,
    "restoreVerified": True,
}
VERIFIED_HEALTH = {"ok": True, "businessAuthority": "cloud", "version": "8.5.0"}
VERIFIED_PERMISSION_CONTRACT = {"contract": "live-authority-result"}


class CloudBusinessDockerDeployTests(unittest.TestCase):
    def setUp(self):
        self.backup_guard = mock.patch.object(
            module,
            "create_verified_backup",
            side_effect=AssertionError("TEST_MUST_MOCK_CLOUD_BACKUP"),
        )
        self.backup_guard.start()
        self.addCleanup(self.backup_guard.stop)
        self.migration_guard = mock.patch.object(
            module,
            "run_cloud_migrations",
            side_effect=AssertionError("TEST_MUST_MOCK_CLOUD_MIGRATIONS"),
        )
        self.migration_guard.start()
        self.addCleanup(self.migration_guard.stop)
        self.permission_guard = mock.patch.object(
            module.verify_cloud_business_release,
            "verify",
            side_effect=AssertionError("TEST_MUST_MOCK_CLOUD_PERMISSION_VERIFICATION"),
        )
        self.permission_guard.start()
        self.addCleanup(self.permission_guard.stop)

    def test_test_process_blocks_real_cloud_migrations_by_default(self):
        with self.assertRaisesRegex(AssertionError, "TEST_MUST_MOCK_CLOUD_MIGRATIONS"):
            module.run_cloud_migrations()

    def test_release_tag_is_stable_and_rejects_unsafe_input(self):
        self.assertEqual(release_tag("8.1.0", "8c425eab"), "8.1.0-8c425eab")
        with self.assertRaisesRegex(ValueError, "CLOUD_DOCKER_DEPLOY_CONFIG_INVALID"):
            release_tag("8.1.0;rm", "8c425eab")

    def test_candidate_name_uses_the_release_tag(self):
        self.assertEqual(candidate_name("8.1.0-8c425eab"), "gewu-cloud-business-api-candidate-8.1.0-8c425eab")

    def test_candidate_health_waits_for_startup(self):
        command = candidate_command("8.1.0-8c425eab", "a" * 32)
        self.assertIn("for attempt in 1 2 3 4 5 6 7 8 9 10", command)
        self.assertIn("sleep 1", command)

    def test_candidate_binds_cleanup_to_its_own_operation_and_always_removes_env_file(self):
        operation_id = "a" * 32
        command = candidate_command("8.1.0-8c425eab", operation_id)
        self.assertIn(f'--label gewu.candidate-operation="{operation_id}"', command)
        self.assertIn("trap 'rm -f -- \"$env_path\" \"$override_path\"' EXIT", command)

    def test_cloud_runtime_overrides_require_the_project_appid_and_matching_secret(self):
        appid = "wx" + "a" * 16
        values = cloud_runtime_overrides({
            "WECHAT_APPID": appid,
            "WECHAT_APPSECRET": "b" * 32,
            "WECHAT_MINIAPP_ENV_VERSION": "develop",
        }, expected_appid=appid)
        self.assertEqual(values, {
            "WECHAT_APPID": appid,
            "WECHAT_APPSECRET": "b" * 32,
            "WECHAT_MINIAPP_LOGIN_ENV_VERSION": "develop",
        })
        with self.assertRaisesRegex(ValueError, "CLOUD_DOCKER_WECHAT_CONFIG_INVALID"):
            cloud_runtime_overrides({
                "WECHAT_APPID": "wx" + "c" * 16,
                "WECHAT_APPSECRET": "b" * 32,
            }, expected_appid=appid)

    def test_candidate_securely_merges_wechat_overrides_and_promotion_reuses_candidate_env(self):
        tag = "8.1.0-8c425eab"
        operation_id = "a" * 32
        override_path = runtime_override_env_path(tag, operation_id)
        candidate = candidate_command(tag, operation_id)
        promoted = switch_command(tag, operation_id)
        self.assertIn(f"override_path='{override_path}'", candidate)
        self.assertIn("/^WECHAT_APPID=/d", candidate)
        self.assertIn("/^WECHAT_APPSECRET=/d", candidate)
        self.assertIn("/^WECHAT_MINIAPP_LOGIN_ENV_VERSION=/d", candidate)
        self.assertIn('cat "$override_path" >> "$env_path"', candidate)
        self.assertIn('rm -f -- "$env_path" "$override_path"', candidate)
        self.assertIn('docker inspect -f', promoted)
        self.assertIn('"$candidate" > "$env_path"', promoted)

    def test_runtime_override_upload_is_private_and_contains_only_validated_wechat_values(self):
        tag = "8.1.0-8c425eab"
        operation_id = "a" * 32
        ssh = mock.Mock()
        sftp = mock.MagicMock()
        handle = mock.MagicMock()
        ssh.open_sftp.return_value = sftp
        sftp.open.return_value.__enter__.return_value = handle
        expected_path = runtime_override_env_path(tag, operation_id)

        actual_path = module.upload_runtime_override_file(ssh, tag, operation_id, {
            "WECHAT_APPID": "wx" + "a" * 16,
            "WECHAT_APPSECRET": "b" * 32,
            "WECHAT_MINIAPP_LOGIN_ENV_VERSION": "develop",
        })

        self.assertEqual(actual_path, expected_path)
        sftp.open.assert_called_once_with(expected_path, "w")
        sftp.chmod.assert_called_once_with(expected_path, 0o600)
        handle.write.assert_called_once_with(
            f"WECHAT_APPID={'wx' + 'a' * 16}\n"
            f"WECHAT_APPSECRET={'b' * 32}\n"
            "WECHAT_MINIAPP_LOGIN_ENV_VERSION=develop\n"
        )
        sftp.close.assert_called_once_with()

    def test_candidate_and_promoted_cloud_service_enable_the_paper_export_worker(self):
        for command in (candidate_command("8.1.0-8c425eab", "a" * 32), switch_command("8.1.0-8c425eab", "b" * 32)):
            self.assertIn("CLOUD_PAPER_EXPORT_WORKER_ENABLED=1", command)
            self.assertIn("sed -i", command)

    def test_switch_always_removes_the_copied_environment_file(self):
        command = switch_command("8.1.0-8c425eab", "b" * 32)
        self.assertIn("trap 'rm -f -- \"$env_path\"' EXIT", command)

    def test_switch_command_keeps_a_rollback_container_and_recovers_on_health_failure(self):
        command = switch_command("8.1.0-8c425eab", "a" * 32)
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
            switch_command("8.3.0-current;id", "a" * 32)

    def test_candidate_tag_must_match_the_checked_out_source(self):
        with mock.patch.object(module, "source_version", return_value="8.5.0"), mock.patch.object(
            module, "source_revision", return_value="1101687f349d"
        ):
            self.assertEqual(module.validated_release_tag(), "8.5.0-1101687f349d")
            with self.assertRaisesRegex(ValueError, "CLOUD_DOCKER_DEPLOY_CONFIG_INVALID"):
                module.validated_release_tag("8.5.0-deadbee")

    def test_upload_source_reuses_only_an_existing_real_directory_for_the_same_immutable_tag(self):
        ssh = mock.Mock()
        ssh.open_sftp.return_value = mock.Mock()
        with mock.patch.object(module.deploy, "run") as run:
            module.upload_source(ssh, "8.5.0-1101687f349d")
        command = run.call_args_list[0].args[1]
        self.assertIn("test -d '/root/gewu-cloud-business-builds/8.5.0-1101687f349d'", command)
        self.assertIn("test ! -L '/root/gewu-cloud-business-builds/8.5.0-1101687f349d'", command)
        self.assertIn("elif test ! -e '/root/gewu-cloud-business-builds/8.5.0-1101687f349d'; then mkdir -p", command)
        uploaded = [call.args[1] for call in ssh.open_sftp.return_value.put.call_args_list]
        self.assertTrue(any(path.endswith('/backend/assets/fonts/NotoSansCJKsc-Regular.otf') for path in uploaded))

    def test_explicit_rollback_restores_the_preserved_container(self):
        command = rollback_command("8.5.0-1101687f349d", "a" * 32)
        self.assertIn("rollback-8.5.0-1101687f349d", command)
        self.assertIn('docker rm -f "$current"', command)
        self.assertIn('docker rename "$rollback" "$current"', command)
        self.assertIn("127.0.0.1:3002/api/health", command)
        self.assertIn("flock -x 9", command)

    def test_uncertain_switch_reconciliation_serializes_and_restores_if_needed(self):
        command = reconcile_switch_failure_command("8.5.0-b195691c27e9", "a" * 32)
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

    def test_failed_candidate_cleanup_requires_the_creating_operation(self):
        operation_id = "c" * 32
        command = module.discard_candidate_command("8.4.1-881fe92c01ff", operation_id)
        self.assertIn("gewu-cloud-business-api-candidate-8.4.1-881fe92c01ff", command)
        self.assertIn('gewu.candidate-operation', command)
        self.assertIn(operation_id, command)
        self.assertIn('"$actual" = "$owner"', command)

    def test_promotion_lock_is_atomic_owned_and_records_recovery_metadata(self):
        operation_id = "a" * 32
        tag = "8.5.0-8a40b41050be"
        acquire = promotion_lock_acquire_command(operation_id, tag)
        release = promotion_lock_release_command(operation_id)
        heartbeat = promotion_lock_heartbeat_command(operation_id, tag)
        claim = promotion_lock_recovery_claim_command("b" * 32, tag)
        self.assertIn(module.PROMOTION_GUARD_LOCK_PATH, acquire)
        self.assertIn('[ ! -s "$lock" ]', acquire)
        self.assertIn('flock -n "$lock" rm -f', acquire)
        self.assertIn('ln "$tmp" "$lock"', acquire)
        self.assertIn("$(date +%s)", acquire)
        self.assertIn(operation_id, acquire)
        self.assertIn(tag, acquire)
        self.assertIn('if [ "$actual_owner" = "$owner" ]', release)
        self.assertIn('test "$actual_owner" = "$owner"', heartbeat)
        self.assertIn("age=$((now - created))", claim)
        self.assertIn('mv -f -- "$tmp" "$lock"', claim)
        self.assertIn(str(module.PROMOTION_LOCK_STALE_SECONDS), claim)

    def test_every_promoted_container_mutation_is_fenced_by_the_operation_owner(self):
        operation_id = "d" * 32
        tag = "8.5.0-ed202e9d5fb7"
        for command in (
            switch_command(tag, operation_id),
            rollback_command(tag, operation_id),
            reconcile_switch_failure_command(tag, operation_id),
        ):
            self.assertIn(module.PROMOTION_GUARD_LOCK_PATH, command)
            self.assertIn('test "$actual_owner" = "$owner"', command)
            self.assertIn('test "$actual_tag" = "$expected_tag"', command)
            self.assertIn("$(date +%s)", command)

    def test_stale_lock_recovery_requires_explicit_mode_and_verification(self):
        stale = {"operationId": "c" * 32, "ageSeconds": 901}
        pending_manifest = {"targets": {"cloud_business": {"status": "pending"}}}
        with mock.patch.object(module.secrets, "token_hex", return_value="d" * 32), mock.patch.object(
            module, "validated_release_tag", return_value="8.5.0-8a40b41050be"
        ), mock.patch.object(
            module, "claim_stale_promotion_lock", return_value=stale
        ) as claim, mock.patch.object(
            module, "reconcile_uncertain_switch"
        ) as reconcile, mock.patch.object(module, "verify_public_health") as verify, mock.patch.object(
            module, "verify_current_release_tag"
        ) as verify_tag, mock.patch.object(
            module, "release_promotion_lock"
        ) as release:
            result = module.recover_promotion_lock("8.5.0-8a40b41050be", "rollback")
        claim.assert_called_once_with("8.5.0-8a40b41050be", "d" * 32)
        reconcile.assert_called_once_with("8.5.0-8a40b41050be", "d" * 32)
        verify.assert_not_called()
        verify_tag.assert_not_called()
        release.assert_called_once_with("d" * 32)
        self.assertEqual(result["ageSeconds"], 901)

        with mock.patch.object(module, "validated_release_tag", return_value="8.5.0-8a40b41050be"), mock.patch.object(
            module, "claim_stale_promotion_lock"
        ) as claim, mock.patch.object(
            module.deploy,
            "require_release_manifest",
            side_effect=SystemExit("Unified release target cloud_business is not in an allowed state"),
        ) as require_manifest, mock.patch.object(module.deploy, "record_release_receipt") as receipt:
            with self.assertRaisesRegex(SystemExit, "not in an allowed state"):
                module.recover_promotion_lock("8.5.0-8a40b41050be", "preserve")
        require_manifest.assert_called_once_with("cloud_business", allowed_statuses=("verified",))
        claim.assert_not_called()
        receipt.assert_not_called()

    def test_preserve_recovery_rejects_a_stale_tag_from_another_commit_before_claim(self):
        with mock.patch.object(module, "source_version", return_value="8.5.0"), mock.patch.object(
            module, "source_revision", return_value="fb899bbdd414"
        ), mock.patch.object(module, "claim_stale_promotion_lock") as claim:
            with self.assertRaisesRegex(ValueError, "CLOUD_DOCKER_DEPLOY_CONFIG_INVALID"):
                module.recover_promotion_lock("8.5.0-deadbee", "preserve")
        claim.assert_not_called()

    def test_preserve_recovery_accepts_an_existing_verified_receipt_and_only_unlocks(self):
        tag = "8.5.0-fb899bbdd414"
        manifest = {
            "targets": {
                "cloud_business": {
                    "status": "verified",
                    "receipt": {"version": "8.5.0", "verifiedAt": "2026-08-25T00:00:00Z", "evidence": "ok"},
                }
            }
        }
        stale = {"operationId": "c" * 32, "ageSeconds": 901}
        with mock.patch.object(module, "validated_release_tag", return_value=tag), mock.patch.object(
            module.secrets, "token_hex", return_value="d" * 32
        ), mock.patch.object(module.deploy, "require_release_manifest", return_value=manifest) as require_manifest, mock.patch.object(
            module, "claim_stale_promotion_lock", return_value=stale
        ), mock.patch.object(module, "verify_current_release_tag"), mock.patch.object(
            module, "verify_public_health", return_value={"ok": True}
        ), mock.patch.object(
            module.verify_cloud_business_release, "verify", return_value=VERIFIED_PERMISSION_CONTRACT
        ), mock.patch.object(module, "heartbeat_promotion_lock"), mock.patch.object(
            module.deploy, "record_release_receipt"
        ) as receipt, mock.patch.object(module, "release_promotion_lock") as release:
            result = module.recover_promotion_lock(tag, "preserve")
        receipt.assert_not_called()
        require_manifest.assert_called_once_with("cloud_business", allowed_statuses=("verified",))
        release.assert_called_once_with("d" * 32)
        self.assertEqual(result["ageSeconds"], 901)

    def test_complete_promotion_lifecycle_holds_one_operation_lock(self):
        health = VERIFIED_HEALTH
        with mock.patch.object(module.secrets, "token_hex", return_value="b" * 32), mock.patch.object(
            module, "acquire_promotion_lock"
        ) as acquire, mock.patch.object(module, "release_promotion_lock") as release, mock.patch.object(
            module, "promote_candidate_under_lock", return_value=health
        ) as promote:
            self.assertEqual(module.promote_validated_candidate("8.5.0-980f2c842eab", "8.5.0", VERIFIED_BACKUP), health)
        acquire.assert_called_once_with("b" * 32, "8.5.0-980f2c842eab")
        promote.assert_called_once_with("8.5.0-980f2c842eab", "8.5.0", VERIFIED_BACKUP, "b" * 32)
        release.assert_called_once_with("b" * 32)

    def test_successful_promotion_revalidates_the_promoted_container_before_health_and_receipt_in_order(self):
        tag = "8.5.0-fb899bbdd414"
        operation_id = "e" * 32
        events = []
        ssh = mock.Mock()
        with mock.patch.object(module.deploy, "connect", return_value=ssh), mock.patch.object(
            module.deploy, "run", side_effect=lambda *_args, **_kwargs: events.append("switch") or ("", "")
        ), mock.patch.object(
            module, "heartbeat_promotion_lock", side_effect=lambda *_args: events.append("heartbeat")
        ) as heartbeat, mock.patch.object(
            module, "verify_current_release_tag", side_effect=lambda *_args: events.append("tag")
        ) as verify_tag, mock.patch.object(
            module, "verify_public_health", side_effect=lambda *_args: events.append("health") or VERIFIED_HEALTH
        ), mock.patch.object(
            module.verify_cloud_business_release,
            "verify",
            side_effect=lambda: events.append("permissions") or VERIFIED_PERMISSION_CONTRACT,
        ), mock.patch.object(
            module, "verified_release_evidence", side_effect=lambda *_args: events.append("evidence") or "bound-evidence"
        ), mock.patch.object(
            module.deploy, "record_release_receipt", side_effect=lambda *_args: events.append("receipt")
        ):
            module.promote_candidate_under_lock(tag, "8.5.0", VERIFIED_BACKUP, operation_id)
        self.assertEqual(events, ["switch", "heartbeat", "tag", "heartbeat", "health", "heartbeat", "permissions", "heartbeat", "evidence", "receipt"])
        self.assertEqual(heartbeat.call_args_list, [mock.call(operation_id, tag), mock.call(operation_id, tag), mock.call(operation_id, tag), mock.call(operation_id, tag)])
        verify_tag.assert_called_once_with(tag)

    def test_permission_contract_failure_rolls_back_and_skips_receipt(self):
        switch_ssh = mock.Mock()
        tag_ssh = mock.Mock()
        rollback_ssh = mock.Mock()
        with mock.patch.object(
            module.deploy, "connect", side_effect=[switch_ssh, tag_ssh, rollback_ssh]
        ), mock.patch.object(module.deploy, "run") as run, mock.patch.object(
            module, "heartbeat_promotion_lock"
        ), mock.patch.object(module, "verify_public_health", return_value=VERIFIED_HEALTH), mock.patch.object(
            module.verify_cloud_business_release,
            "verify",
            side_effect=RuntimeError("CLOUD_BUSINESS_RELEASE_DIRECT_WRITE_OPEN"),
        ), mock.patch.object(module.deploy, "record_release_receipt") as receipt:
            with self.assertRaisesRegex(RuntimeError, "DIRECT_WRITE_OPEN"):
                module.promote_candidate_under_lock("8.5.0-fb899bbdd414", "8.5.0", VERIFIED_BACKUP, "e" * 32)
        receipt.assert_not_called()
        self.assertIn("rollback-8.5.0-fb899bbdd414", run.call_args_list[-1].args[1])

    def test_cloud_migrations_apply_control_plane_before_business_schema(self):
        with mock.patch.object(module.subprocess, "run") as run:
            run.return_value.returncode = 0
            self.assertEqual(REAL_RUN_CLOUD_MIGRATIONS(), 0)
        self.assertEqual(len(run.call_args_list), 10)
        self.assertTrue(str(run.call_args_list[0].args[0][1]).endswith("apply_cloud_control_plane_m20.py"))
        self.assertTrue(str(run.call_args_list[1].args[0][1]).endswith("apply_cloud_control_plane_m21.py"))
        self.assertTrue(str(run.call_args_list[2].args[0][1]).endswith("apply_cloud_control_plane_m22.py"))
        self.assertTrue(str(run.call_args_list[3].args[0][1]).endswith("apply_cloud_control_plane_m23.py"))
        self.assertTrue(str(run.call_args_list[4].args[0][1]).endswith("apply_cloud_control_plane_m24.py"))
        self.assertTrue(str(run.call_args_list[5].args[0][1]).endswith("apply_cloud_control_plane_m25.py"))
        self.assertTrue(str(run.call_args_list[6].args[0][1]).endswith("apply_cloud_control_plane_m26.py"))
        self.assertTrue(str(run.call_args_list[7].args[0][1]).endswith("apply_cloud_control_plane_m27.py"))
        self.assertTrue(str(run.call_args_list[8].args[0][1]).endswith("apply_cloud_control_plane_m28.py"))
        self.assertTrue(str(run.call_args_list[9].args[0][1]).endswith("apply_cloud_postgres_migrations.py"))

    def test_verified_backup_requires_exact_recovery_artifacts_and_checksum(self):
        with mock.patch.object(module.backup_cloud_postgres, "create_backup", return_value=VERIFIED_BACKUP) as create:
            self.assertEqual(REAL_CREATE_VERIFIED_BACKUP(), VERIFIED_BACKUP)
        create.assert_called_once_with(container="gewu-postgres17", database="gewu_cloud", role="gewu_app")

        invalid = {**VERIFIED_BACKUP, "sha256": "not-a-checksum"}
        with mock.patch.object(module.backup_cloud_postgres, "create_backup", return_value=invalid):
            with self.assertRaisesRegex(RuntimeError, "CLOUD_POSTGRES_BACKUP_VERIFICATION_FAILED"):
                REAL_CREATE_VERIFIED_BACKUP()
        invalid = {**VERIFIED_BACKUP, "restoreVerified": False}
        with mock.patch.object(module.backup_cloud_postgres, "create_backup", return_value=invalid):
            with self.assertRaisesRegex(RuntimeError, "CLOUD_POSTGRES_BACKUP_VERIFICATION_FAILED"):
                REAL_CREATE_VERIFIED_BACKUP()

    def test_release_evidence_is_derived_from_live_health_permission_and_restore_results(self):
        with mock.patch.object(
            module.verify_cloud_business_release,
            "validate",
            return_value=VERIFIED_PERMISSION_CONTRACT,
        ) as validate:
            evidence = module.verified_release_evidence(
                "8.5.0", VERIFIED_BACKUP, VERIFIED_HEALTH, VERIFIED_PERMISSION_CONTRACT
            )
        validate.assert_called_once_with(dict(VERIFIED_PERMISSION_CONTRACT))
        self.assertIn("healthContractSha256=", evidence)
        self.assertIn("authorityContractSha256=", evidence)
        self.assertIn("restore-verified=true", evidence)
        with self.assertRaisesRegex(RuntimeError, "CLOUD_RELEASE_EVIDENCE_INVALID"):
            module.verified_release_evidence(
                "8.5.0", VERIFIED_BACKUP, {**VERIFIED_HEALTH, "ok": False}, VERIFIED_PERMISSION_CONTRACT
            )

    def test_deploy_applies_verified_migrations_before_starting_candidate(self):
        events = []
        ssh = mock.Mock()
        with mock.patch.object(module, "source_version", return_value="8.5.0"), mock.patch.object(
            module, "source_revision", return_value="1165783d"
        ), mock.patch.object(module.deploy, "require_release_manifest"), mock.patch.object(
            module.deploy, "connect", return_value=ssh
        ), mock.patch.object(module, "upload_source", side_effect=lambda *_args: events.append("upload")), mock.patch.object(
            module, "build_image", side_effect=lambda *_args: events.append("build")
        ), mock.patch.object(
            module, "create_verified_backup", side_effect=lambda: events.append("backup") or VERIFIED_BACKUP
        ), mock.patch.object(
             module, "deploy_retirement_gateway", side_effect=lambda: events.append("gateway") or {"ok": True}
        ), mock.patch.object(module, "run_cloud_migrations", side_effect=lambda: events.append("migrate") or 0), mock.patch.object(
            module, "upload_runtime_override_file", side_effect=lambda *_args: events.append("runtime") or "/tmp/runtime.env"
        ), mock.patch.object(
            module.deploy, "run", side_effect=lambda *_args, **_kwargs: events.append("candidate") or ("", "")
        ), mock.patch.object(module, "promote_validated_candidate", side_effect=lambda *_args: events.append("promote") or {"ok": True}):
            self.assertEqual(module.deploy_release(), {"ok": True})
        self.assertEqual(events, ["upload", "build", "backup", "gateway", "migrate", "runtime", "candidate", "promote"])

    def test_backup_failure_blocks_migrations_candidate_and_promotion(self):
        ssh = mock.Mock()
        with mock.patch.object(module, "source_version", return_value="8.5.0"), mock.patch.object(
            module, "source_revision", return_value="1165783d"
        ), mock.patch.object(module.deploy, "require_release_manifest"), mock.patch.object(
            module.deploy, "connect", return_value=ssh
        ), mock.patch.object(module, "upload_source"), mock.patch.object(module, "build_image"), mock.patch.object(
            module, "create_verified_backup", side_effect=RuntimeError("CLOUD_POSTGRES_BACKUP_VERIFICATION_FAILED")
        ), mock.patch.object(module, "deploy_retirement_gateway") as gateway, mock.patch.object(module, "run_cloud_migrations") as migrate, mock.patch.object(
            module.deploy, "run"
        ) as run, mock.patch.object(module, "promote_validated_candidate") as promote:
            with self.assertRaisesRegex(RuntimeError, "CLOUD_POSTGRES_BACKUP_VERIFICATION_FAILED"):
                module.deploy_release()
        gateway.assert_not_called()
        migrate.assert_not_called()
        run.assert_not_called()
        promote.assert_not_called()

    def test_gateway_failure_blocks_migrations_candidate_promotion_and_receipt(self):
        ssh = mock.Mock()
        with mock.patch.object(module, "source_version", return_value="8.5.0"), mock.patch.object(
            module, "source_revision", return_value="1165783d"
        ), mock.patch.object(module.deploy, "require_release_manifest"), mock.patch.object(
            module.deploy, "connect", return_value=ssh
        ), mock.patch.object(module, "upload_source"), mock.patch.object(module, "build_image"), mock.patch.object(
            module, "create_verified_backup", return_value=VERIFIED_BACKUP
        ), mock.patch.object(
            module, "deploy_retirement_gateway", side_effect=RuntimeError("GATEWAY_RETIREMENT_HEALTH_INVALID")
        ), mock.patch.object(module, "run_cloud_migrations") as migrate, mock.patch.object(
            module.deploy, "run"
        ) as run, mock.patch.object(module, "promote_validated_candidate") as promote, mock.patch.object(
            module.deploy, "record_release_receipt"
        ) as receipt:
            with self.assertRaisesRegex(RuntimeError, "GATEWAY_RETIREMENT_HEALTH_INVALID"):
                module.deploy_release()
        migrate.assert_not_called()
        run.assert_not_called()
        promote.assert_not_called()
        receipt.assert_not_called()

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

    def test_public_health_targets_the_cloud_business_nginx_location(self):
        nginx = (module.ROOT / "scripts" / "nginx-scheduling.conf").read_text(encoding="utf-8")
        self.assertIn("location /cloud-business/", nginx)
        self.assertIn("proxy_pass http://172.18.0.1:3002/", nginx)
        self.assertEqual(module.health_url(), "https://physicsedu.xyz/cloud-business/api/health")

    def test_public_cloud_health_also_requires_the_retirement_gateway(self):
        ssh = mock.Mock()
        with mock.patch.object(module.deploy, "connect", return_value=ssh), mock.patch.object(
            module.deploy,
            "run",
            return_value=(' {"ok":true,"businessAuthority":"cloud","version":"8.5.0"} ', ""),
        ), mock.patch.object(
            module,
            "verify_public_gateway_retirement",
            side_effect=RuntimeError("GATEWAY_RETIREMENT_TOMBSTONE_INVALID"),
        ) as gateway:
            with self.assertRaisesRegex(RuntimeError, "GATEWAY_RETIREMENT_TOMBSTONE_INVALID"):
                module.verify_public_health("8.5.0")
        gateway.assert_called_once_with("8.5.0")

    def test_public_gateway_retirement_verifies_health_tombstones_and_ws_rejection(self):
        ssh = mock.Mock()
        responses = [
            ('{"ok":true,"version":"8.5.0","legacyAuthority":"retired"}', ""),
            ("410", ""), ("410", ""), ("410", ""), ("410", ""),
            ("404", ""), ("404", ""),
        ]
        with mock.patch.object(module.deploy, "connect", return_value=ssh), mock.patch.object(
            module.deploy, "run", side_effect=responses
        ) as run:
            result = module.verify_public_gateway_retirement("8.5.0")
        self.assertEqual(result["legacyAuthority"], "retired")
        commands = [call.args[1] for call in run.call_args_list]
        self.assertTrue(all("https://physicsedu.xyz/scheduling/" in command for command in commands))
        self.assertEqual(sum("Upgrade: websocket" in command for command in commands), 2)
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
            module, "create_verified_backup", return_value=VERIFIED_BACKUP
        ), mock.patch.object(module, "deploy_retirement_gateway") as deploy_gateway, mock.patch.object(
            module, "upload_runtime_override_file", return_value="/tmp/runtime.env"
        ), mock.patch.object(
            module.deploy, "run"
        ), mock.patch.object(module, "run_cloud_migrations", return_value=0), mock.patch.object(
            module, "verify_public_health", return_value=health
        ) as verify_health, mock.patch.object(
            module.verify_cloud_business_release, "verify", return_value=VERIFIED_PERMISSION_CONTRACT
        ), mock.patch.object(
            module.verify_cloud_business_release, "validate", return_value=VERIFIED_PERMISSION_CONTRACT
        ), mock.patch.object(
            module, "acquire_promotion_lock", return_value=mock.Mock()
        ), mock.patch.object(
            module, "release_promotion_lock"
        ):
            self.assertEqual(module.deploy_release(), health)
        require_manifest.assert_called_once_with("cloud_business")
        deploy_gateway.assert_called_once_with()
        verify_health.assert_called_once_with("8.5.0")
        record_receipt.assert_called_once()
        self.assertEqual(record_receipt.call_args.args[0], "cloud_business")
        self.assertIn("8.5.0", record_receipt.call_args.args[1])
        self.assertIn(VERIFIED_BACKUP["root"], record_receipt.call_args.args[1])
        self.assertIn(VERIFIED_BACKUP["sha256"], record_receipt.call_args.args[1])

    def test_candidate_start_failure_discards_only_its_exact_candidate(self):
        ssh = mock.Mock()
        tag = "8.5.0-1165783d"
        operation_id = "d" * 32
        with mock.patch.object(module.secrets, "token_hex", return_value=operation_id), mock.patch.object(
            module, "source_version", return_value="8.5.0"
        ), mock.patch.object(
            module, "source_revision", return_value="1165783d"
        ), mock.patch.object(module.deploy, "require_release_manifest"), mock.patch.object(
            module.deploy, "connect", return_value=ssh
        ), mock.patch.object(module, "upload_source"), mock.patch.object(module, "build_image"), mock.patch.object(
            module, "create_verified_backup", return_value=VERIFIED_BACKUP
        ), mock.patch.object(module, "deploy_retirement_gateway"), mock.patch.object(module, "run_cloud_migrations", return_value=0
        ), mock.patch.object(module, "upload_runtime_override_file", return_value=module.runtime_override_env_path(tag, operation_id)
        ), mock.patch.object(
            module.deploy, "run", side_effect=RuntimeError("candidate bind failed")
        ) as run, mock.patch.object(module, "promote_validated_candidate") as promote:
            with self.assertRaisesRegex(RuntimeError, "candidate bind failed"):
                module.deploy_release()
        self.assertEqual(run.call_count, 2)
        self.assertIn(f'--label gewu.candidate-operation="{operation_id}"', run.call_args_list[0].args[1])
        self.assertIn("gewu.candidate-operation", run.call_args_list[1].args[1])
        self.assertIn(operation_id, run.call_args_list[1].args[1])
        promote.assert_not_called()
        ssh.close.assert_called_once()

    def test_public_health_failure_rolls_back_and_skips_receipt(self):
        switch_ssh = mock.Mock()
        tag_ssh = mock.Mock()
        rollback_ssh = mock.Mock()
        with mock.patch.object(module, "acquire_promotion_lock", return_value=mock.Mock()), mock.patch.object(
            module, "release_promotion_lock"
        ), mock.patch.object(
            module.deploy, "connect", side_effect=[switch_ssh, tag_ssh, rollback_ssh]
        ), mock.patch.object(
            module.deploy, "run"
        ) as run, mock.patch.object(module, "heartbeat_promotion_lock"), mock.patch.object(
            module, "verify_public_health", side_effect=RuntimeError("CLOUD_DOCKER_DEPLOY_HEALTH_INVALID")
        ), mock.patch.object(module.deploy, "record_release_receipt") as record_receipt:
            with self.assertRaisesRegex(RuntimeError, "CLOUD_DOCKER_DEPLOY_HEALTH_INVALID"):
                module.promote_validated_candidate("8.5.0-1101687f349d", "8.5.0", VERIFIED_BACKUP)
        self.assertEqual(run.call_count, 3)
        self.assertIn("rollback-8.5.0-1101687f349d", run.call_args_list[2].args[1])
        record_receipt.assert_not_called()
        switch_ssh.close.assert_called_once()
        tag_ssh.close.assert_called_once()
        rollback_ssh.close.assert_called_once()

    def test_receipt_failure_rolls_back_the_switched_release(self):
        switch_ssh = mock.Mock()
        tag_ssh = mock.Mock()
        rollback_ssh = mock.Mock()
        with mock.patch.object(module, "acquire_promotion_lock", return_value=mock.Mock()), mock.patch.object(
            module, "release_promotion_lock"
        ), mock.patch.object(
            module.deploy, "connect", side_effect=[switch_ssh, tag_ssh, rollback_ssh]
        ), mock.patch.object(
            module.deploy, "run"
        ) as run, mock.patch.object(module, "heartbeat_promotion_lock"), mock.patch.object(
            module, "verify_public_health", return_value=VERIFIED_HEALTH
        ), mock.patch.object(
            module.verify_cloud_business_release, "verify", return_value=VERIFIED_PERMISSION_CONTRACT
        ), mock.patch.object(
            module, "verified_release_evidence", return_value="bound-evidence"
        ), mock.patch.object(
            module.deploy, "record_release_receipt", side_effect=OSError("receipt write failed")
        ):
            with self.assertRaisesRegex(OSError, "receipt write failed"):
                module.promote_validated_candidate("8.5.0-1101687f349d", "8.5.0", VERIFIED_BACKUP)
        self.assertEqual(run.call_count, 3)
        self.assertIn("rollback-8.5.0-1101687f349d", run.call_args_list[2].args[1])
        tag_ssh.close.assert_called_once()

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
                module.promote_validated_candidate("8.5.0-b195691c27e9", "8.5.0", VERIFIED_BACKUP)
        self.assertEqual(run.call_count, 2)
        self.assertIn("flock -x 9", run.call_args_list[0].args[1])
        self.assertIn("rollback-8.5.0-b195691c27e9", run.call_args_list[1].args[1])
        verify_health.assert_not_called()
        record_receipt.assert_not_called()
        switch_ssh.close.assert_called_once()
        reconcile_ssh.close.assert_called_once()

    def test_promote_rejects_a_candidate_from_another_source_revision(self):
        with self.assertRaisesRegex(RuntimeError, "CLOUD_STANDALONE_PROMOTION_RETIRED"):
            module.promote_release("8.5.0-deadbee")

    def test_standalone_candidate_and_promote_commands_are_not_exposed(self):
        source = (module.ROOT / "scripts" / "deploy_cloud_business_api.py").read_text(encoding="utf-8")
        self.assertIn('choices=("deploy", "discard", "recover-lock")', source)
        self.assertNotIn('if args.command == "candidate"', source)
        self.assertNotIn('if args.command == "promote"', source)


if __name__ == "__main__":
    unittest.main()
