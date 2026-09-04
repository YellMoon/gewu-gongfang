import importlib.util
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "verify_public_question_import_limit",
    Path(__file__).with_name("verify_public_question_import_limit.py"),
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


command = MODULE.smoke_command(7 * 1024 * 1024)
assert "head -c 7340032 /dev/zero" in command
assert "--data-binary @-" in command
assert "https://physicsedu.xyz/cloud-business/api/desktop/question-imports" in command

assert MODULE.validate_status("400\n") == 400
assert MODULE.validate_status("401") == 401
try:
    MODULE.validate_status("413")
except RuntimeError as error:
    assert str(error) == "PUBLIC_QUESTION_IMPORT_BODY_LIMIT_REJECTED"
else:
    raise AssertionError("413 response accepted")

for invalid in ("200", "500", "garbage"):
    try:
        MODULE.validate_status(invalid)
    except RuntimeError as error:
        assert str(error) == "PUBLIC_QUESTION_IMPORT_SMOKE_INVALID"
    else:
        raise AssertionError(f"invalid smoke response accepted: {invalid}")

print("public question import body-limit smoke checks passed")
