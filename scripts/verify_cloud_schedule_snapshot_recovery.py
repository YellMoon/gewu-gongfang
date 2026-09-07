"""Verify recovery in a new full-backup shadow, never in the production database."""
import argparse
import hashlib
import json
import pathlib
import re
import secrets
import subprocess
import tempfile

import deploy
from apply_cloud_postgres_migrations import DockerPsqlExecutor, apply_migrations, read_migrations

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHA = re.compile(r"^[a-f0-9]{64}$")
BACKUP_ROOT = re.compile(r"^/root/scheduling-backups/postgres/[0-9]{8}-[0-9]{6}$")


def validate_probe_receipt(result, target, plan_hash, backup_hash, expected_count):
    flags = ("ok", "fullBackupRestored", "freshConnectionRetryVerified", "failedReceiptWriteRolledBack",
             "failedRollbackReceiptRolledBack", "nonRecoveryDataUnchanged", "rollbackChangedVersionsOnly")
    counts = ("candidateCount", "applied", "rolledBack")
    if (not isinstance(result, dict) or not re.fullmatch(r"gewu_snapshot_shadow_[a-f0-9]{16}", target)
            or type(expected_count) is not int or expected_count <= 0
            or any(result.get(key) is not True for key in flags) or result.get("productionWrite") is not False
            or result.get("database") != target or result.get("planSha256") != plan_hash or result.get("backupSha256") != backup_hash
            or any(type(result.get(key)) is not int or result[key] != expected_count for key in counts)
            or type(result.get("persistentReceiptCount")) is not int or result["persistentReceiptCount"] != 1):
        raise RuntimeError("SHADOW_PROBE_RECEIPT_INVALID")


def validate_inputs(capture_directory, plan_path, backup_path):
    capture = pathlib.Path(capture_directory).resolve(strict=True)
    plan_file = pathlib.Path(plan_path).resolve(strict=True)
    backup_file = pathlib.Path(backup_path).resolve(strict=True)
    if plan_file.parent != capture or backup_file.parent != capture:
        raise RuntimeError("SHADOW_INPUT_OUTSIDE_CAPTURE")
    backup = json.loads(backup_file.read_text(encoding="utf-8"))
    root = backup.get("root", "")
    if not BACKUP_ROOT.fullmatch(root) or backup.get("dump") != root + "/gewu_cloud.dump" or not SHA.fullmatch(backup.get("sha256", "")) or backup.get("restoreVerified") is not True:
        raise RuntimeError("SHADOW_VERIFIED_BACKUP_REQUIRED")
    plan_hash = hashlib.sha256(plan_file.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix="gewu-shadow-plan-check-") as temp:
        result = subprocess.run(["node", str(ROOT / "scripts/vnext-migration/planCapturedScheduleSnapshotRecovery.js"), str(capture), str(pathlib.Path(temp) / "proposal.json")], capture_output=True, text=True, encoding="utf-8", check=True, cwd=ROOT)
        if json.loads(result.stdout)["proposalSha256"] != plan_hash:
            raise RuntimeError("SHADOW_PLAN_EVIDENCE_CHANGED")
    return capture, plan_file, backup, plan_hash


def verify(capture_directory, plan_path, backup_path):
    capture, plan_file, backup, plan_hash = validate_inputs(capture_directory, plan_path, backup_path)
    nonce = secrets.token_hex(8)
    target = "gewu_snapshot_shadow_" + nonce
    container = "gewu-snapshot-operator-" + nonce
    remote = "/tmp/gewu-snapshot-operator-" + nonce
    assert re.fullmatch(r"gewu_snapshot_shadow_[a-f0-9]{16}", target) and target != "gewu_cloud"
    ssh = deploy.connect()
    created = staged = operator_created = False

    def safe(command):
        return deploy.run(ssh, command, timeout=180)[0]

    def private(command, payload=None):
        # Docker inspect may contain credentials. Never route it through a logger.
        stdin, stdout, stderr = ssh.exec_command(command, timeout=180)
        if payload is not None:
            stdin.write(json.dumps(payload, ensure_ascii=True))
            stdin.flush()
        stdin.channel.shutdown_write()
        body = stdout.read().decode("utf-8")
        error = stderr.read().decode("utf-8")
        status = stdout.channel.recv_exit_status()
        if status:
            # Probe errors contain only a fixed stage/code, never input or PG detail.
            try:
                failure = json.loads(error.strip().splitlines()[-1])
                if set(failure) == {"ok", "stage", "code"}:
                    raise RuntimeError("SHADOW_PROBE_FAILED:" + str(failure["stage"]) + ":" + str(failure["code"]))
            except (ValueError, IndexError):
                pass
            raise RuntimeError("SHADOW_OPERATOR_COMMAND_FAILED")
        return body

    try:
        checksum = safe("cd '" + backup["root"] + "' && sha256sum gewu_cloud.dump").split()[0]
        if checksum != backup["sha256"]:
            raise RuntimeError("SHADOW_BACKUP_CHECKSUM_CHANGED")
        maintenance = DockerPsqlExecutor(ssh, "gewu-postgres17", "postgres", "gewu_app")
        if maintenance.run("SELECT count(*) FROM pg_database WHERE datname='" + target + "'").strip() != "0":
            raise RuntimeError("SHADOW_DATABASE_ALREADY_EXISTS")
        safe("docker exec gewu-postgres17 createdb -U gewu_app -T template0 '" + target + "'")
        created = True
        safe("docker exec -i gewu-postgres17 pg_restore -U gewu_app --exit-on-error --single-transaction -d '" + target + "' < '" + backup["dump"] + "'")
        db = DockerPsqlExecutor(ssh, "gewu-postgres17", target, "gewu_app")
        if db.run("SELECT current_database()").strip() != target:
            raise RuntimeError("SHADOW_TARGET_MISMATCH")
        migration_result = apply_migrations(db, read_migrations(ROOT / "cloud-business-api/sql"))
        print(json.dumps({"stage": "full_shadow_migrated", "database": target, "appliedMigrations": migration_result["applied"]}), flush=True)
        pg = json.loads(private("docker inspect gewu-postgres17"))[0]
        app = json.loads(private("docker inspect gewu-cloud-business-api"))[0]
        image = app["Image"]
        networks = sorted(set(pg["NetworkSettings"]["Networks"]) & set(app["NetworkSettings"]["Networks"]))
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", image) or not networks or not re.fullmatch(r"[A-Za-z0-9_.-]+", networks[0]):
            raise RuntimeError("SHADOW_OPERATOR_RUNTIME_UNAVAILABLE")
        env = dict(item.split("=", 1) for item in pg["Config"]["Env"] if "=" in item)
        if env.get("POSTGRES_USER") != "gewu_app" or not env.get("POSTGRES_PASSWORD"):
            raise RuntimeError("SHADOW_ADMIN_CONNECTION_UNAVAILABLE")
        connection = {"host": pg["NetworkSettings"]["Networks"][networks[0]]["IPAddress"], "port": 5432, "database": target, "user": "gewu_app", "password": env["POSTGRES_PASSWORD"]}
        pg = app = env = None
        safe("umask 077; mkdir '" + remote + "'")
        staged = True
        sftp = ssh.open_sftp()
        try:
            for name in ("scheduleSnapshotRecoveryTransaction.js", "scheduleSnapshotRecoveryReceipts.js", "scheduleSnapshotRecoveryShadowProbe.js"):
                sftp.put(str(ROOT / "scripts/vnext-migration" / name), remote + "/" + name)
                sftp.chmod(remote + "/" + name, 0o600)
            sftp.put(str(plan_file), remote + "/plan.json")
            sftp.chmod(remote + "/plan.json", 0o600)
        finally:
            sftp.close()
        safe("docker create --name '" + container + "' --network '" + networks[0] + "' --user 0 --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m --interactive --mount 'type=bind,source=" + remote + ",target=/recovery,readonly' --entrypoint node '" + image + "' /recovery/scheduleSnapshotRecoveryShadowProbe.js")
        operator_created = True
        body = private("docker start -ai '" + container + "'", {"connection": connection, "planSha256": plan_hash, "backupSha256": backup["sha256"]})
        connection = None
        result = json.loads(body.strip().splitlines()[-1])
        expected_count = len(json.loads(plan_file.read_text(encoding="utf-8"))["candidates"])
        validate_probe_receipt(result, target, plan_hash, backup["sha256"], expected_count)
        result["appliedMigrations"] = migration_result["applied"]
        output = capture / ("cloud-shadow-recovery-" + nonce + ".json")
        with output.open("x", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
        print(json.dumps(result), flush=True)
        return result
    finally:
        try:
            if operator_created:
                safe("docker rm -f '" + container + "'")
            if created:
                safe("docker exec gewu-postgres17 dropdb -U gewu_app --if-exists '" + target + "'")
            if staged:
                # Exact fresh nonce directory only, never a project/backup/user folder.
                safe("rm -rf -- '" + remote + "'")
            print(json.dumps({"shadowCleanupComplete": True, "database": target}), flush=True)
        finally:
            ssh.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("capture_directory")
    parser.add_argument("plan_path")
    parser.add_argument("backup_path")
    args = parser.parse_args()
    verify(args.capture_directory, args.plan_path, args.backup_path)
