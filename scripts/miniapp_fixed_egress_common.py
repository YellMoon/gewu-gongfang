"""Shared contracts for the local miniapp fixed-egress workflow."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]

MINIAPP_FIXED_EGRESS_ALREADY_RUNNING = "MINIAPP_FIXED_EGRESS_ALREADY_RUNNING"
MINIAPP_FIXED_EGRESS_CHILD_FAILED = "MINIAPP_FIXED_EGRESS_CHILD_FAILED"
MINIAPP_FIXED_EGRESS_CHILD_TIMEOUT = "MINIAPP_FIXED_EGRESS_CHILD_TIMEOUT"
MINIAPP_FIXED_EGRESS_CLEANUP_FAILED = "MINIAPP_FIXED_EGRESS_CLEANUP_FAILED"
MINIAPP_FIXED_EGRESS_CONCURRENCY_LIMIT = "MINIAPP_FIXED_EGRESS_CONCURRENCY_LIMIT"
MINIAPP_FIXED_EGRESS_HEALTH_UNHEALTHY = "MINIAPP_FIXED_EGRESS_HEALTH_UNHEALTHY"
MINIAPP_FIXED_EGRESS_HEALTH_VERSION = "MINIAPP_FIXED_EGRESS_HEALTH_VERSION"
MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS = "MINIAPP_FIXED_EGRESS_INVALID_ARGUMENTS"
MINIAPP_FIXED_EGRESS_INVALID_CONFIG = "MINIAPP_FIXED_EGRESS_INVALID_CONFIG"
MINIAPP_FIXED_EGRESS_INTERRUPTED = "MINIAPP_FIXED_EGRESS_INTERRUPTED"
MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT = "MINIAPP_FIXED_EGRESS_LOCAL_PREFLIGHT"
MINIAPP_FIXED_EGRESS_LOCK_FAILED = "MINIAPP_FIXED_EGRESS_LOCK_FAILED"
MINIAPP_FIXED_EGRESS_MISMATCH = "MINIAPP_FIXED_EGRESS_MISMATCH"
MINIAPP_FIXED_EGRESS_PROXY_FAILURE = "MINIAPP_FIXED_EGRESS_PROXY_FAILURE"
MINIAPP_FIXED_EGRESS_SENSITIVE_ARGV = "MINIAPP_FIXED_EGRESS_SENSITIVE_ARGV"
MINIAPP_FIXED_EGRESS_SSH_INACTIVE = "MINIAPP_FIXED_EGRESS_SSH_INACTIVE"
MINIAPP_FIXED_EGRESS_UNEXPECTED = "MINIAPP_FIXED_EGRESS_UNEXPECTED"


class FixedEgressError(RuntimeError):
    """Stable, non-secret-bearing fixed-egress failure."""

    def __init__(self, code: str, detail: str = ""):
        self.code = code
        self.codes = (code,)
        self.detail = detail
        self.exit_status = 1
        super().__init__(f"{code}: {detail}" if detail else code)


class FixedEgressCompositeError(FixedEgressError):
    """Multiple stable failure codes without secret-bearing exception text."""

    def __init__(self, codes, *, exit_status: int = 1):
        normalized = tuple(dict.fromkeys(codes))
        if not normalized or any(not isinstance(code, str) or not code for code in normalized):
            raise ValueError("at least one stable failure code is required")
        self.code = normalized[0]
        self.codes = normalized
        self.detail = ""
        self.exit_status = exit_status
        RuntimeError.__init__(self, "+".join(normalized))
