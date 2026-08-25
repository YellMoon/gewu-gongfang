#!/usr/bin/env python3
"""Key-only deployment for the NAS-controlled storage agent.

This tool deliberately does not know a NAS password.  A password is accepted
only by the one-time ``bootstrap-key`` command through an interactive prompt;
normal deployments authenticate with an ED25519 private key and preserve the
previous container as the rollback candidate.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import shlex
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


VERSION = re.compile(r"^\d+\.\d+\.\d+$")
CONTAINER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$")
REMOTE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
HOST_FINGERPRINT = re.compile(r"^SHA256:[A-Za-z0-9+/]{43}$")
PUBLIC_KEY = re.compile(r"^ssh-ed25519 [A-Za-z0-9+/=]+ [A-Za-z0-9._-]{1,64}$")


class DeployError(RuntimeError):
    pass


def fail(message: str) -> DeployError:
    return DeployError(message)


def require_version(value: str) -> str:
    if not VERSION.fullmatch(str(value or "")):
        raise fail("NAS_DEPLOY_INVALID_VERSION")
    return value


def require_container_name(value: str) -> str:
    if not CONTAINER.fullmatch(str(value or "")):
        raise fail("NAS_DEPLOY_INVALID_CONTAINER")
    return value


def require_image(value: str) -> str:
    if not IMAGE.fullmatch(str(value or "")):
        raise fail("NAS_DEPLOY_INVALID_IMAGE")
    return value


def require_mount_source(value: str) -> str:
    if not REMOTE_PATH.fullmatch(str(value or "")):
        raise fail("NAS_DEPLOY_INVALID_MOUNT_SOURCE")
    return value


def require_remote_path(value: str) -> str:
    if not REMOTE_PATH.fullmatch(str(value or "")):
        raise fail("NAS_DEPLOY_INVALID_REMOTE_PATH")
    return value


def require_host(value: str) -> str:
    host = str(value or "").strip()
    if not host or len(host) > 253 or any(char.isspace() for char in host) or "/" in host or "\\" in host:
        raise fail("NAS_DEPLOY_INVALID_HOST")
    return host


def require_user(value: str) -> str:
    user = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", user):
        raise fail("NAS_DEPLOY_INVALID_USER")
    return user


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def remote_artifact_path(digest: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", str(digest or "")):
        raise fail("NAS_DEPLOY_INVALID_ARTIFACT_DIGEST")
    return f"/tmp/gewu-storage-agent/{digest}.tar"


def host_key_fingerprint(key: paramiko.PKey) -> str:
    return "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode("ascii").rstrip("=")


def read_host_key(host: str, port: int, timeout: int = 10) -> paramiko.PKey:
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            transport = paramiko.Transport(sock)
            try:
                transport.start_client(timeout=timeout)
                return transport.get_remote_server_key()
            finally:
                transport.close()
    except (OSError, paramiko.SSHException) as error:
        raise fail(f"NAS_DEPLOY_HOST_KEY_UNAVAILABLE: {error}") from error


def assert_host_key_fingerprint(host: str, port: int, expected: str) -> paramiko.PKey:
    if not HOST_FINGERPRINT.fullmatch(str(expected or "")):
        raise fail("NAS_DEPLOY_INVALID_HOST_KEY_FINGERPRINT")
    key = read_host_key(host, port)
    observed = host_key_fingerprint(key)
    if observed != expected:
        raise fail(f"NAS_DEPLOY_HOST_KEY_MISMATCH: expected {expected}, observed {observed}")
    return key


def host_key_name(host: str, port: int) -> str:
    return host if port == 22 else f"[{host}]:{port}"


def load_private_key(path: Path) -> paramiko.PKey:
    loaders = (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey)
    for loader in loaders:
        try:
            return loader.from_private_key_file(str(path))
        except paramiko.PasswordRequiredException:
            passphrase = getpass.getpass("SSH private-key passphrase: ")
            return loader.from_private_key_file(str(path), password=passphrase)
        except paramiko.SSHException:
            continue
    raise fail("NAS_DEPLOY_UNSUPPORTED_PRIVATE_KEY")


def connect_checked(*, host: str, port: int, user: str, host_key: paramiko.PKey,
                    private_key: Optional[paramiko.PKey] = None, password: Optional[str] = None) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.get_host_keys().add(host_key_name(host, port), host_key.get_name(), host_key)
    try:
        client.connect(hostname=host, port=port, username=user, pkey=private_key, password=password,
                       look_for_keys=False, allow_agent=False, timeout=15, banner_timeout=15, auth_timeout=15)
        return client
    except (OSError, paramiko.SSHException) as error:
        client.close()
        raise fail(f"NAS_DEPLOY_SSH_AUTH_FAILED: {error}") from error


def ensure_keypair(key_path: Path) -> tuple[Path, Path]:
    private_path = key_path.expanduser().resolve()
    public_path = Path(f"{private_path}.pub")
    if private_path.exists() and public_path.exists():
        return private_path, public_path
    if private_path.exists() or public_path.exists():
        raise fail("NAS_DEPLOY_PARTIAL_KEYPAIR_EXISTS")
    private_path.parent.mkdir(parents=True, exist_ok=True)
    private = Ed25519PrivateKey.generate()
    private_bytes = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.OpenSSH,
        serialization.NoEncryption(),
    )
    public_bytes = private.public_key().public_bytes(
        serialization.Encoding.OpenSSH,
        serialization.PublicFormat.OpenSSH,
    )
    private_path.write_bytes(private_bytes)
    tighten_private_key_permissions(private_path)
    public_path.write_bytes(public_bytes + b" gewu-nas-deploy\n")
    return private_path, public_path


def tighten_private_key_permissions(path: Path) -> None:
    if os.name != "nt":
        os.chmod(path, 0o600)
        return
    user = getpass.getuser()
    result = subprocess.run(
        ["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:F"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise fail("NAS_DEPLOY_PRIVATE_KEY_ACL_FAILED")


def read_public_key(path: Path) -> str:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise fail(f"NAS_DEPLOY_PUBLIC_KEY_UNAVAILABLE: {error}") from error
    if not PUBLIC_KEY.fullmatch(value):
        raise fail("NAS_DEPLOY_INVALID_PUBLIC_KEY")
    return value


def authorized_key_command(public_key: str) -> str:
    if not PUBLIC_KEY.fullmatch(str(public_key or "")):
        raise fail("NAS_DEPLOY_INVALID_PUBLIC_KEY")
    quoted = shlex.quote(public_key)
    return (
        "umask 077; mkdir -p ~/.ssh; chmod 700 ~/.ssh; touch ~/.ssh/authorized_keys; "
        "chmod 600 ~/.ssh/authorized_keys; "
        f"grep -qxF {quoted} ~/.ssh/authorized_keys || printf '%s\\n' {quoted} >> ~/.ssh/authorized_keys"
    )


@dataclass
class Remote:
    client: paramiko.SSHClient
    sudo_password: Optional[str] = None

    def run(self, command: str, *, timeout: int = 120, check: bool = True) -> tuple[str, str, int]:
        if self.sudo_password is not None:
            command = f"sudo -S -p '' sh -lc {shlex.quote(command)}"
        stdin, stdout, stderr = self.client.exec_command(command, timeout=timeout)
        if self.sudo_password is not None:
            stdin.write(self.sudo_password + "\n")
            stdin.flush()
        output = stdout.read().decode("utf-8", errors="replace")
        error = stderr.read().decode("utf-8", errors="replace")
        status = stdout.channel.recv_exit_status()
        if check and status != 0:
            raise fail(f"NAS_DEPLOY_REMOTE_COMMAND_FAILED ({status}): {error.strip() or output.strip()}")
        return output, error, status

    def upload(self, local_path: Path, remote_path: str) -> None:
        sftp = self.client.open_sftp()
        try:
            sftp.put(str(local_path), remote_path)
        finally:
            sftp.close()


def deployment_commands(*, image: str, candidate_container: str, previous_container: str,
                        mount_source: str, mount_target: str, network: str, restart_policy: str,
                        config_path: str, version: str) -> dict[str, str]:
    image = require_image(image)
    candidate_container = require_container_name(candidate_container)
    previous_container = require_container_name(previous_container)
    mount_source = require_mount_source(mount_source)
    mount_target = require_remote_path(mount_target)
    config_path = require_remote_path(config_path)
    require_version(version)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", network or ""):
        raise fail("NAS_DEPLOY_INVALID_NETWORK")
    if restart_policy not in {"no", "always", "unless-stopped", "on-failure"}:
        raise fail("NAS_DEPLOY_INVALID_RESTART_POLICY")
    return {
        "create": (
            f"docker container inspect {candidate_container} >/dev/null 2>&1 && exit 41; "
            f"docker create --name {candidate_container} --restart {restart_policy} --network {network} "
            f"-v {mount_source}:{mount_target}:rw {image}"
        ),
        "stop_previous": f"docker stop {previous_container}",
        "start_candidate": f"docker start {candidate_container}",
        "assert_running": f"test \"$(docker inspect -f '{{{{.State.Running}}}}' {candidate_container})\" = true",
        "health": f"docker exec {candidate_container} node src/healthCli.js {config_path}",
        "stop_candidate": f"docker stop {candidate_container}",
        "rollback": f"docker start {previous_container}",
    }


def remote_container_exists(remote: Remote, name: str) -> bool:
    _, _, status = remote.run(f"docker container inspect {require_container_name(name)} >/dev/null 2>&1", check=False)
    return status == 0


def container_inspection_commands(name: str) -> dict[str, str]:
    """Return only the non-secret container facts needed for a repeat deployment."""
    name = require_container_name(name)
    return {
        "mounts": f"docker inspect --format '{{{{json .Mounts}}}}' {name}",
        "image": f"docker inspect --format '{{{{.Config.Image}}}}' {name}",
        "running": f"docker inspect --format '{{{{.State.Running}}}}' {name}",
        "network": f"docker inspect --format '{{{{.HostConfig.NetworkMode}}}}' {name}",
        "restartPolicy": f"docker inspect --format '{{{{.HostConfig.RestartPolicy.Name}}}}' {name}",
    }


def inspect_container(args: argparse.Namespace) -> dict:
    host = require_host(args.host)
    user = require_user(args.user)
    port = int(args.port)
    if not 1 <= port <= 65535:
        raise fail("NAS_DEPLOY_INVALID_PORT")
    key_path = Path(args.key).expanduser().resolve()
    if not key_path.is_file():
        raise fail("NAS_DEPLOY_PRIVATE_KEY_REQUIRED")
    host_key = assert_host_key_fingerprint(host, port, args.host_key_fingerprint)
    sudo_password = getpass.getpass("NAS sudo password (not stored): ") if args.sudo else None
    remote = Remote(connect_checked(host=host, port=port, user=user, host_key=host_key,
                                    private_key=load_private_key(key_path)), sudo_password=sudo_password)
    try:
        commands = container_inspection_commands(args.container)
        mounts, _, _ = remote.run(commands["mounts"])
        image, _, _ = remote.run(commands["image"])
        running, _, _ = remote.run(commands["running"])
        network, _, _ = remote.run(commands["network"])
        restart_policy, _, _ = remote.run(commands["restartPolicy"])
        return {
            "ok": True,
            "container": require_container_name(args.container),
            "image": image.strip(),
            "running": running.strip() == "true",
            "mounts": json.loads(mounts),
            "network": network.strip(),
            "restartPolicy": restart_policy.strip(),
        }
    finally:
        remote.client.close()


def deploy(args: argparse.Namespace) -> dict:
    artifact = Path(args.artifact).expanduser().resolve()
    if not artifact.is_file() or artifact.stat().st_size < 1:
        raise fail("NAS_DEPLOY_ARTIFACT_REQUIRED")
    host = require_host(args.host)
    user = require_user(args.user)
    port = int(args.port)
    if not 1 <= port <= 65535:
        raise fail("NAS_DEPLOY_INVALID_PORT")
    version = require_version(args.version)
    image = require_image(args.image or f"gewu-storage-agent:{version}")
    candidate = require_container_name(args.container or f"gewu-storage-agent-{version}")
    previous = require_container_name(args.previous_container)
    key_path = Path(args.key).expanduser().resolve()
    if not key_path.is_file():
        raise fail("NAS_DEPLOY_PRIVATE_KEY_REQUIRED")
    digest = sha256_file(artifact)
    remote_path = remote_artifact_path(digest)
    host_key = assert_host_key_fingerprint(host, port, args.host_key_fingerprint)
    sudo_password = getpass.getpass("NAS sudo password (not stored): ") if args.sudo else None
    remote = Remote(connect_checked(host=host, port=port, user=user, host_key=host_key,
                                    private_key=load_private_key(key_path)), sudo_password=sudo_password)
    previous_was_running = False
    commands = deployment_commands(
        image=image, candidate_container=candidate, previous_container=previous,
        mount_source=args.mount_source, mount_target=args.mount_target,
        network=args.network, restart_policy=args.restart_policy,
        config_path=args.config_path, version=version,
    )
    try:
        remote.run(f"mkdir -p {shlex.quote(str(Path(remote_path).parent))}")
        remote.upload(artifact, remote_path)
        observed, _, _ = remote.run(
            f"(sha256sum {remote_path} || busybox sha256sum {remote_path}) | awk '{{print $1}}'"
        )
        if observed.strip() != digest:
            raise fail("NAS_DEPLOY_ARTIFACT_DIGEST_MISMATCH")
        remote.run(f"docker load --input {remote_path}", timeout=600)
        remote.run(f"docker image inspect {image} >/dev/null")
        if remote_container_exists(remote, candidate):
            raise fail("NAS_DEPLOY_CANDIDATE_CONTAINER_ALREADY_EXISTS")
        remote.run(commands["create"])
        previous_exists = remote_container_exists(remote, previous)
        if previous_exists:
            state, _, _ = remote.run(f"docker inspect -f '{{{{.State.Running}}}}' {previous}")
            previous_was_running = state.strip() == "true"
            if previous_was_running:
                remote.run(commands["stop_previous"])
        try:
            remote.run(commands["start_candidate"])
            time.sleep(3)
            remote.run(commands["assert_running"])
            health, _, _ = remote.run(commands["health"])
            report = json.loads(health)
            if report.get("ok") is not True or report.get("version") != version or report.get("writableAuthority") is not False:
                raise fail("NAS_DEPLOY_HEALTH_CONTRACT_FAILED")
        except Exception:
            remote.run(commands["stop_candidate"], check=False)
            if previous_exists and previous_was_running:
                remote.run(commands["rollback"], check=False)
            raise
        return {
            "ok": True,
            "version": version,
            "image": image,
            "container": candidate,
            "rollbackContainer": previous if previous_exists else None,
            "artifactSha256": digest,
            "health": report,
        }
    finally:
        remote.client.close()


def build_artifact(args: argparse.Namespace) -> dict:
    version = require_version(args.version)
    image = require_image(args.image or f"gewu-storage-agent:{version}")
    artifact = Path(args.artifact).expanduser().resolve()
    if artifact.suffix.lower() != ".tar":
        raise fail("NAS_DEPLOY_ARTIFACT_MUST_BE_TAR")
    project_root = Path(__file__).resolve().parent.parent
    dockerfile = project_root / "storage-agent" / "Dockerfile"
    if not dockerfile.is_file():
        raise fail("NAS_DEPLOY_DOCKERFILE_REQUIRED")
    artifact.parent.mkdir(parents=True, exist_ok=True)
    temporary = artifact.with_suffix(".tmp.tar")
    if temporary.exists():
        temporary.unlink()
    try:
        subprocess.run(
            ["docker", "build", "--pull=false", "-t", image, "-f", str(dockerfile), "."],
            cwd=project_root, check=True,
        )
        subprocess.run(["docker", "save", "--output", str(temporary), image], check=True)
        if not temporary.is_file() or temporary.stat().st_size < 1:
            raise fail("NAS_DEPLOY_ARTIFACT_BUILD_FAILED")
        os.replace(temporary, artifact)
    except FileNotFoundError as error:
        raise fail("NAS_DEPLOY_DOCKER_UNAVAILABLE") from error
    except subprocess.CalledProcessError as error:
        raise fail(f"NAS_DEPLOY_DOCKER_BUILD_FAILED: {error.returncode}") from error
    finally:
        if temporary.exists():
            temporary.unlink()
    return {"ok": True, "version": version, "image": image, "artifact": str(artifact),
            "sha256": sha256_file(artifact)}


def bootstrap_key(args: argparse.Namespace) -> dict:
    host = require_host(args.host)
    user = require_user(args.user)
    port = int(args.port)
    private_path, public_path = ensure_keypair(Path(args.key))
    host_key = assert_host_key_fingerprint(host, port, args.host_key_fingerprint)
    password = getpass.getpass(f"NAS password for {user} (one-time bootstrap; not stored): ")
    client = connect_checked(host=host, port=port, user=user, host_key=host_key, password=password)
    try:
        remote = Remote(client)
        remote.run(authorized_key_command(read_public_key(public_path)))
    finally:
        client.close()
    verification = connect_checked(host=host, port=port, user=user, host_key=host_key,
                                  private_key=load_private_key(private_path))
    verification.close()
    return {"ok": True, "keyPath": str(private_path), "publicKeyPath": str(public_path),
            "hostKeyFingerprint": args.host_key_fingerprint}


def cli() -> None:
    parser = argparse.ArgumentParser(description="Deploy the controlled NAS storage agent by SSH key")
    sub = parser.add_subparsers(dest="command", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--host", required=True)
    common.add_argument("--port", type=int, default=22)
    common.add_argument("--user", required=True)
    common.add_argument("--host-key-fingerprint", required=True)
    common.add_argument("--key", required=True, help="ED25519 private-key path")

    create = sub.add_parser("init-key")
    create.add_argument("--key", required=True)

    bootstrap = sub.add_parser("bootstrap-key", parents=[common])

    inspect = sub.add_parser("inspect", parents=[common], help="Show current image and Docker mount sources")
    inspect.add_argument("--container", required=True)
    inspect.add_argument("--sudo", action="store_true")

    release = sub.add_parser("deploy", parents=[common])
    release.add_argument("--artifact", required=True)
    release.add_argument("--version", required=True)
    release.add_argument("--image")
    release.add_argument("--container")
    release.add_argument("--previous-container", required=True)
    release.add_argument("--mount-source", required=True)
    release.add_argument("--mount-target", default="/nas-storage")
    release.add_argument("--config-path", default="/nas-storage/agent.env")
    release.add_argument("--network", default="bridge")
    release.add_argument("--restart-policy", default="unless-stopped")
    release.add_argument("--sudo", action="store_true")

    build = sub.add_parser("build-artifact")
    build.add_argument("--version", required=True)
    build.add_argument("--artifact", required=True)
    build.add_argument("--image")

    fingerprint = sub.add_parser("host-key")
    fingerprint.add_argument("--host", required=True)
    fingerprint.add_argument("--port", type=int, default=22)

    args = parser.parse_args()
    if args.command == "init-key":
        private_path, public_path = ensure_keypair(Path(args.key))
        result = {"ok": True, "keyPath": str(private_path), "publicKeyPath": str(public_path)}
    elif args.command == "host-key":
        result = {"ok": True, "host": require_host(args.host), "port": args.port,
                  "fingerprint": host_key_fingerprint(read_host_key(args.host, args.port))}
    elif args.command == "bootstrap-key":
        result = bootstrap_key(args)
    elif args.command == "build-artifact":
        result = build_artifact(args)
    elif args.command == "inspect":
        result = inspect_container(args)
    else:
        result = deploy(args)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        cli()
    except DeployError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
