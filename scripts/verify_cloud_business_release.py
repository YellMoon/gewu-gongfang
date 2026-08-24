#!/usr/bin/env python3
"""Verify the deployed cloud authority schema, imported row counts, and write boundary."""

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy
from apply_cloud_postgres_migrations import DockerPsqlExecutor


EXPECTED_COUNTS = {
    "tenants": 1,
    "institutions": 4,
    "schools": 15,
    "rooms": 15,
    "teachers": 1,
    "students": 60,
    "courses": 57,
    "pricings": 69,
    "schedules": 571,
    "overrides": 246,
}


def verification_sql():
    count_queries = {
        "tenants": "SELECT count(*) FROM business.tenants",
        "institutions": "SELECT count(*) FROM business.institutions WHERE legacy_deleted=false",
        "schools": "SELECT count(*) FROM business.schools WHERE legacy_deleted=false",
        "rooms": "SELECT count(*) FROM business.rooms WHERE legacy_deleted=false",
        "teachers": "SELECT count(*) FROM business.teachers WHERE legacy_deleted=false",
        "students": "SELECT count(*) FROM business.students WHERE legacy_deleted=false",
        "courses": "SELECT count(*) FROM business.courses WHERE legacy_deleted=false",
        "pricings": "SELECT count(*) FROM business.course_student_pricings",
        "schedules": "SELECT count(*) FROM business.schedules WHERE legacy_deleted=false",
        "overrides": "SELECT count(*) FROM business.schedule_student_overrides",
    }
    fields = []
    for key, query in count_queries.items():
        fields.extend((f"'{key}'", f"({query})"))
    fields.extend((
        "'scheduleCreateFunction'",
        "to_regprocedure('business.vnext_create_schedule_record_v1(text,text,text,timestamp with time zone,timestamp with time zone,text,integer,text,integer,numeric,numeric,text,jsonb)') IS NOT NULL",
        "'institutionCreateFunction'",
        "to_regprocedure('business.vnext_create_institution_v1(text,text,text,text,text,numeric,text)') IS NOT NULL",
        "'schoolCreateFunction'",
        "to_regprocedure('business.vnext_create_school_v1(text,text,text,integer)') IS NOT NULL",
        "'writerScheduleExecute'",
        "has_function_privilege('vnext_pg17_writer','business.vnext_create_schedule_record_v1(text,text,text,timestamp with time zone,timestamp with time zone,text,integer,text,integer,numeric,numeric,text,jsonb)','EXECUTE')",
        "'writerDirectScheduleInsert'",
        "has_table_privilege('vnext_pg17_writer','business.schedules','INSERT')",
        "'runtimeDirectScheduleInsert'",
        "has_table_privilege('vnext_pg17_runtime','business.schedules','INSERT')",
    ))
    return "SELECT json_build_object(" + ",".join(fields) + ")::text"


def validate(payload):
    if not isinstance(payload, dict):
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_VERIFICATION_FAILED")
    for key, expected in EXPECTED_COUNTS.items():
        if payload.get(key) != expected:
            raise RuntimeError(f"CLOUD_BUSINESS_RELEASE_COUNT_MISMATCH:{key}:{payload.get(key)}:{expected}")
    if any(payload.get(key) is not True for key in ("scheduleCreateFunction", "institutionCreateFunction", "schoolCreateFunction", "writerScheduleExecute")):
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_FUNCTION_MISSING")
    if payload.get("writerDirectScheduleInsert") is not False or payload.get("runtimeDirectScheduleInsert") is not False:
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_DIRECT_WRITE_OPEN")
    return payload


def verify():
    ssh = deploy.connect()
    try:
        raw = DockerPsqlExecutor(ssh, "gewu-postgres17", "gewu_cloud", "gewu_app").run(verification_sql()).strip()
    finally:
        ssh.close()
    try:
        return validate(json.loads(raw))
    except json.JSONDecodeError as error:
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_VERIFICATION_FAILED") from error


if __name__ == "__main__":
    print(json.dumps(verify(), sort_keys=True))
