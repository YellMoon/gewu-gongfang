import importlib.util
import json
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("question_import", Path(__file__).with_name("run_real_question_import_acceptance.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def valid_receipt():
    return {"ok": True, "imports": [
        {"sourceType": "exam", "ready": {"status": "candidates_ready", "itemCount": 1}, "prepared": {"status": "drafts_prepared"}},
        {"sourceType": "lecture", "ready": {"status": "candidates_ready", "itemCount": 1}, "prepared": {"status": "drafts_prepared"}},
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
print("real question import runner checks passed")
