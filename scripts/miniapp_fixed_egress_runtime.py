"""Process lock, exact-child execution, and fixed-egress lifecycle ownership."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
from typing import Callable, Iterable, Mapping, Optional

from miniapp_fixed_egress_common import (
    FixedEgressError,
    FixedEgressCompositeError,
    MINIAPP_FIXED_EGRESS_ALREADY_RUNNING,
    MINIAPP_FIXED_EGRESS_CHILD_FAILED,
    MINIAPP_FIXED_EGRESS_CHILD_TIMEOUT,
    MINIAPP_FIXED_EGRESS_CLEANUP_FAILED,
    MINIAPP_FIXED_EGRESS_INTERRUPTED,
    MINIAPP_FIXED_EGRESS_LOCK_FAILED,
    MINIAPP_FIXED_EGRESS_SENSITIVE_ARGV,
    MINIAPP_FIXED_EGRESS_SSH_INACTIVE,
    MINIAPP_FIXED_EGRESS_UNEXPECTED,
    PROJECT_ROOT,
)
from miniapp_fixed_egress_preflight import (
    FixedEgressConfig,
    _validated_loopback_proxy,
    check_health,
    probe_proxy,
    verify_local_upload_inputs,
)
from miniapp_fixed_egress_proxy import SshConnectProxy


BUILD_TIMEOUT = 15 * 60.0
UPLOAD_TIMEOUT = 20 * 60.0
CHILD_CLEANUP_TIMEOUT = 3.0
DEFAULT_LOCK_PATH = PROJECT_ROOT / "output" / "locks" / "miniapp-fixed-egress.lock"


def _prepare_lock_file(file_object) -> None:
    if os.name == "nt" and os.fstat(file_object.fileno()).st_size < 1:
        file_object.write(b"\0")
    file_object.seek(0)


def _acquire_os_lock(file_object) -> None:
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(file_object.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        fcntl.flock(
            file_object.fileno(),
            fcntl.LOCK_EX | fcntl.LOCK_NB,
        )


def _release_os_lock(file_object) -> None:
    file_object.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(file_object.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(file_object.fileno(), fcntl.LOCK_UN)


def _write_lock_owner(file_object, pid: int) -> None:
    file_object.seek(0)
    file_object.truncate(0)
    file_object.write(f"{pid}\n".encode("ascii"))
    file_object.seek(0)


class UploadLock:
    """An acquired cross-process lock whose descriptor stays open until release."""

    def __init__(self, path: Path, file_object):
        self.path = path
        self._file = file_object
        self.pid = os.getpid()
        self.closed = False

    def release(self) -> None:
        if self.closed:
            return
        file_object = self._file
        try:
            try:
                _release_os_lock(file_object)
            except (OSError, ValueError):
                pass
        finally:
            try:
                file_object.close()
            finally:
                self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        self.release()
        return False


def acquire_upload_lock(lock_path: os.PathLike | str) -> UploadLock:
    """Acquire an OS file lock without blocking or replacing its inode."""
    path = Path(lock_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    except OSError as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCK_FAILED) from error
    try:
        file_object = os.fdopen(descriptor, "r+b", buffering=0)
    except BaseException as error:
        try:
            os.close(descriptor)
        except OSError:
            pass
        if isinstance(error, Exception):
            raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCK_FAILED) from error
        raise

    locked = False
    transferred = False
    try:
        _prepare_lock_file(file_object)
        try:
            _acquire_os_lock(file_object)
        except (OSError, BlockingIOError) as error:
            raise FixedEgressError(MINIAPP_FIXED_EGRESS_ALREADY_RUNNING) from error
        locked = True
        _write_lock_owner(file_object, os.getpid())
        upload_lock = UploadLock(path, file_object)
        transferred = True
        return upload_lock
    except FixedEgressError:
        raise
    except (OSError, ValueError) as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_LOCK_FAILED) from error
    finally:
        if not transferred:
            if locked:
                try:
                    _release_os_lock(file_object)
                except (OSError, ValueError):
                    pass
            file_object.close()


def ensure_active_transport(transport) -> None:
    try:
        active = transport is not None and transport.is_active()
    except Exception as error:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_SSH_INACTIVE) from error
    if not active:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_SSH_INACTIVE)


def build_child_env(base_env: Mapping[str, str], proxy_url: str) -> dict[str, str]:
    _validated_loopback_proxy(proxy_url)
    child_env = dict(base_env)
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        child_env[name] = proxy_url
    child_env.pop("NO_PROXY", None)
    child_env.pop("no_proxy", None)
    return child_env


def _reject_sensitive_argv(argv: list[str], env: Mapping[str, str]) -> None:
    sensitive_values = {
        env.get("WECHAT_MINIAPP_PRIVATE_KEY_PATH", ""),
        env.get("MINIAPP_PRIVATE_KEY_PATH", ""),
        env.get("WX_PRIVATE_KEY_PATH", ""),
    }
    sensitive_values.discard("")
    if any(value in argument for value in sensitive_values for argument in argv):
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_SENSITIVE_ARGV)


def _stop_exact_child(process, cleanup_timeout: float) -> None:
    """Stop only the exact child and prove it is no longer alive."""
    try:
        process.terminate()
    except BaseException:
        pass
    try:
        process.wait(timeout=cleanup_timeout)
        return
    except BaseException:
        pass
    try:
        process.kill()
    except BaseException:
        pass
    try:
        process.wait(timeout=cleanup_timeout)
        return
    except BaseException:
        pass
    try:
        process.wait(timeout=cleanup_timeout)
        return
    except BaseException:
        pass
    try:
        poll = getattr(process, "poll", None)
        exited = callable(poll) and poll() is not None
    except BaseException:
        exited = False
    if not exited:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_CLEANUP_FAILED)


def _stable_primary_failure(error: BaseException) -> tuple[tuple[str, ...], int]:
    if isinstance(error, FixedEgressError):
        return error.codes, error.exit_status
    if isinstance(error, KeyboardInterrupt):
        return (MINIAPP_FIXED_EGRESS_INTERRUPTED,), 130
    if isinstance(error, subprocess.TimeoutExpired):
        return (MINIAPP_FIXED_EGRESS_CHILD_TIMEOUT,), 1
    if isinstance(error, subprocess.CalledProcessError):
        return (f"{MINIAPP_FIXED_EGRESS_CHILD_FAILED}:{error.returncode}",), 1
    return (MINIAPP_FIXED_EGRESS_UNEXPECTED,), 1


def _with_cleanup_failure(primary_error: BaseException) -> FixedEgressCompositeError:
    primary_codes, exit_status = _stable_primary_failure(primary_error)
    return FixedEgressCompositeError(
        (*primary_codes, MINIAPP_FIXED_EGRESS_CLEANUP_FAILED),
        exit_status=exit_status,
    )


def run_exact_child(
    argv: Iterable[os.PathLike | str],
    *,
    cwd: os.PathLike | str,
    env: Mapping[str, str],
    timeout: float,
    cleanup_timeout: float = CHILD_CLEANUP_TIMEOUT,
    popen_factory=subprocess.Popen,
) -> None:
    """Run one child and clean only that Popen object on interruption/timeout."""
    exact_argv = [os.fspath(argument) for argument in argv]
    _reject_sensitive_argv(exact_argv, env)
    process = popen_factory(
        exact_argv,
        cwd=os.fspath(cwd),
        env=dict(env),
        shell=False,
    )
    try:
        return_code = process.wait(timeout=timeout)
    except BaseException as primary_error:
        try:
            _stop_exact_child(process, cleanup_timeout)
        except FixedEgressError:
            raise _with_cleanup_failure(primary_error) from primary_error
        raise
    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, exact_argv)


def node_executable() -> str:
    return shutil.which("node") or "node"


def npm_executable() -> str:
    executable = "npm.cmd" if os.name == "nt" else "npm"
    return shutil.which(executable) or executable


def _cleanup_lifecycle(upload_lock, ssh, proxy) -> None:
    """Clean every acquired resource and surface only a stable cleanup failure."""
    failed = False

    def attempt(callback):
        nonlocal failed
        try:
            callback()
        except BaseException:
            failed = True

    two_phase_proxy = bool(
        proxy is not None
        and callable(getattr(proxy, "shutdown_resources", None))
        and callable(getattr(proxy, "wait_closed", None))
    )
    if proxy is not None:
        if two_phase_proxy:
            attempt(proxy.shutdown_resources)
        else:
            attempt(proxy.close)
    if ssh is not None:
        attempt(ssh.close)
    if two_phase_proxy:
        attempt(proxy.wait_closed)
    if upload_lock is not None:
        attempt(upload_lock.release)
    if failed:
        raise FixedEgressError(MINIAPP_FIXED_EGRESS_CLEANUP_FAILED)


def run_receipt_reconciliation(
    config: FixedEgressConfig,
    *,
    env: Mapping[str, str],
    lock_path: Path = DEFAULT_LOCK_PATH,
    lock_factory=acquire_upload_lock,
    health_checker=check_health,
    receipt_validator: Optional[Callable[[], None]] = None,
    receipt_finalizer: Optional[Callable[[], None]] = None,
) -> None:
    """Validate and finalize one deferred receipt without any upload network path."""
    if receipt_validator is None or receipt_finalizer is None:
        raise TypeError("receipt_validator and receipt_finalizer are required")
    del env
    upload_lock = None
    primary_error = None
    try:
        upload_lock = lock_factory(lock_path)
        receipt_validator()
        for health_url in config.health_urls:
            health_checker(health_url, config.expected_cloud_business_version)
        receipt_finalizer()
    except BaseException as error:
        primary_error = error
        raise
    finally:
        try:
            _cleanup_lifecycle(upload_lock, None, None)
        except FixedEgressError:
            if primary_error is None:
                raise
            raise _with_cleanup_failure(primary_error) from primary_error


def run_lifecycle(
    config: FixedEgressConfig,
    *,
    probe_only: bool,
    env: Mapping[str, str],
    lock_path: Path = DEFAULT_LOCK_PATH,
    lock_factory=acquire_upload_lock,
    health_checker=check_health,
    local_preflight=None,
    ssh_connector=None,
    proxy_factory=None,
    proxy_prober=probe_proxy,
    command_runner=run_exact_child,
    receipt_finalizer: Optional[Callable[[], None]] = None,
) -> None:
    """Own the lock/build/SSH/proxy/upload/health/cleanup ordering."""
    if ssh_connector is None:
        raise TypeError("ssh_connector is required")
    if local_preflight is None:
        local_preflight = lambda current_env: verify_local_upload_inputs(
            current_env,
            expected_miniapp_version=config.expected_miniapp_version,
        )
    if proxy_factory is None:
        proxy_factory = lambda transport, allowlist: SshConnectProxy(
            transport,
            allowlist,
        )

    upload_lock = None
    ssh = None
    proxy = None
    primary_error = None
    try:
        upload_lock = lock_factory(lock_path)
        for health_url in config.health_urls:
            health_checker(health_url, config.expected_cloud_business_version)

        if not probe_only:
            command_runner(
                [npm_executable(), "run", "miniapp:release-check"],
                cwd=PROJECT_ROOT,
                env=dict(env),
                timeout=BUILD_TIMEOUT,
            )
            local_preflight(env)

        ssh = ssh_connector()
        transport = ssh.get_transport()
        ensure_active_transport(transport)

        proxy = proxy_factory(transport, config.allowlist)
        proxy.start()
        proxy_prober(proxy.url, config.echo_url, config.fixed_egress_ip)

        if not probe_only:
            child_env = build_child_env(env, proxy.url)
            command_runner(
                [
                    node_executable(),
                    "scripts/upload-miniapp.js",
                    "--upload-mode=miniprogram-ci",
                    f"--proxy={proxy.url}",
                    "--threads=1",
                    "--defer-receipt",
                ],
                cwd=PROJECT_ROOT,
                env=child_env,
                timeout=UPLOAD_TIMEOUT,
            )

        for health_url in config.health_urls:
            health_checker(health_url, config.expected_cloud_business_version)
        if not probe_only and receipt_finalizer is not None:
            receipt_finalizer()
    except BaseException as error:
        primary_error = error
        raise
    finally:
        try:
            _cleanup_lifecycle(upload_lock, ssh, proxy)
        except FixedEgressError:
            if primary_error is None:
                raise
            raise _with_cleanup_failure(primary_error) from primary_error
