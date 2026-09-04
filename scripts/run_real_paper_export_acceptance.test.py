import importlib.util
import hashlib
import json
import tempfile
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("paper_export", Path(__file__).with_name("run_real_paper_export_acceptance.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def valid_receipt():
    return {
        "ok": True,
        "questionIds": ["question-import-exam", "question-import-lecture"],
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

try:
    invalid = valid_receipt()
    invalid.pop("questionIds")
    MODULE.receipt(json.dumps(invalid))
except ValueError as error:
    assert str(error) == "REAL_PAPER_EXPORT_RECEIPT_INVALID"
else:
    raise AssertionError("receipt without explicit question IDs accepted")

try:
    invalid = valid_receipt()
    invalid["questionIds"] = [["not-hashable"], "question-import-lecture"]
    MODULE.receipt(json.dumps(invalid))
except ValueError as error:
    assert str(error) == "REAL_PAPER_EXPORT_RECEIPT_INVALID"
else:
    raise AssertionError("receipt with non-string question IDs accepted")

assert "docker cp" in MODULE.copy_artifact_command("pdf")
assert "rm -f" in MODULE.cleanup_command()
assert "rm -f" in MODULE.prepare_command()
assert "docker exec -u 0 gewu-cloud-business-api rm -f" in MODULE.prepare_command()
assert MODULE.copy_verification_command() == "docker exec gewu-cloud-business-api test -s '/app/real-paper-export-acceptance.js' && docker exec gewu-cloud-business-api test -s '/app/real-cloud-business-acceptance.js'"
with tempfile.TemporaryDirectory() as directory:
    source = Path(directory) / "sample.docx"
    source.write_bytes(b"explicit paper source")
    assert MODULE.sha256_file(source) == hashlib.sha256(b"explicit paper source").hexdigest()
command = MODULE.export_command("a" * 64, "b" * 64, "c" * 64)
assert "REAL_QUESTION_IMPORT_EXAM_SHA256='" + "a" * 64 + "'" in command
assert "REAL_QUESTION_IMPORT_LECTURE_SHA256='" + "b" * 64 + "'" in command
assert "REAL_PAPER_EXPORT_RENDERER_SHA256='" + "c" * 64 + "'" in command
print("real paper export runner checks passed")
