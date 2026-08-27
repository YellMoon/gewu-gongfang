import importlib.util
import json
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("paper_export", Path(__file__).with_name("run_real_paper_export_acceptance.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def valid_receipt():
    return {
        "ok": True,
        "artifacts": [
            {"format": "pdf", "bytes": 100, "sha256": "a" * 64, "path": "/tmp/proof.pdf"},
            {"format": "word", "bytes": 100, "sha256": "b" * 64, "path": "/tmp/proof.docx"},
        ],
    }


assert MODULE.receipt(json.dumps(valid_receipt())) == valid_receipt()
try:
    MODULE.receipt(json.dumps({"ok": True, "artifacts": []}))
except ValueError as error:
    assert str(error) == "REAL_PAPER_EXPORT_RECEIPT_INVALID"
else:
    raise AssertionError("invalid receipt accepted")

assert "docker cp" in MODULE.copy_artifact_command("pdf")
assert "rm -f" in MODULE.cleanup_command()
print("real paper export runner checks passed")
