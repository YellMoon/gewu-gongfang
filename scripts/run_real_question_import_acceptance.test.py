import importlib.util
import hashlib
import json
import tempfile
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("question_import", Path(__file__).with_name("run_real_question_import_acceptance.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def valid_receipt():
    return {"ok": True, "imports": [
        {"sourceType": "exam", "sourceSha256": "a" * 64, "sourceBytes": 100, "parserSha256": "c" * 64,
         "reused": False, "ready": {"status": "candidates_ready", "itemCount": 1},
         "prepared": {"status": "drafts_prepared", "itemCount": 1, "acceptedOrWarningCount": 1},
         "final": {"status": "drafts_prepared", "itemCount": 1, "acceptedOrWarningCount": 1}},
        {"sourceType": "lecture", "sourceSha256": "b" * 64, "sourceBytes": 200, "parserSha256": "c" * 64,
         "reused": True, "final": {"status": "submitted", "itemCount": 88, "acceptedOrWarningCount": 88}},
    ]}


assert MODULE.receipt(json.dumps(valid_receipt())) == valid_receipt()
try:
    MODULE.receipt(json.dumps({"ok": True, "imports": []}))
except ValueError as error:
    assert str(error) == "REAL_QUESTION_IMPORT_RECEIPT_INVALID"
else:
    raise AssertionError("invalid receipt accepted")

assert "GRANT vnext_pg17_owner" in MODULE.grant_owner_command()
assert "REVOKE vnext_pg17_owner" in MODULE.revoke_owner_command()
with tempfile.TemporaryDirectory() as directory:
    source = Path(directory) / "parse_word.py"
    source.write_bytes(b"parser revision fixture")
    digest = hashlib.sha256(b"parser revision fixture").hexdigest()
    assert MODULE.sha256_file(source) == digest
    assert f"REAL_QUESTION_IMPORT_PARSER_SHA256='{digest}'" in MODULE.import_command(digest)
print("real question import runner checks passed")
