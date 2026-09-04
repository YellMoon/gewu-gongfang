#!/usr/bin/env python3
"""Verify the deployed cloud authority schema, imported row counts, and write boundary."""

import json
import hmac
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
CONTROL_PLANE_M20_ID = "vnext-pg17-fixed-super-admin-invariant-20"
CONTROL_PLANE_M20_SHA256 = "96c48125a805aa0d26684fcd59d9b9d6dd92eae6f8609db15830755063182934"
CONTROL_PLANE_M21_ID = "vnext-pg17-desktop-session-context-reader-21"
CONTROL_PLANE_M21_SHA256 = "877a5159d4aee994129b7553f39e8d8309a3f81b317b59dd3e467a42b57d7d93"
CONTROL_PLANE_M22_ID = "vnext-pg17-desktop-canonical-phone-reader-22"
CONTROL_PLANE_M22_SHA256 = "1c01a3467b90f66fbee3029802b0d5bd4a2547f1955aebffb7aca12cd4d60fee"
CONTROL_PLANE_M23_ID = "vnext-pg17-desktop-cloud-session-control-23"
CONTROL_PLANE_M23_SHA256 = "3e028ebdad2b59e83c12882c8091f2d956952a68f2d7d2573caf358a852f3d83"
CONTROL_PLANE_M24_ID = "vnext-pg17-desktop-device-revoke-status-fix-24"
CONTROL_PLANE_M24_SHA256 = "47464b060d376727826c9ab2d3589e279dd3ebc63713fe8e7cecde71e02aa974"
CONTROL_PLANE_M25_ID = "vnext-pg17-desktop-session-source-lock-25"
CONTROL_PLANE_M25_SHA256 = "0b9a7a2f7cbd29fcbfb12391636657396ed3be153ccd5fef88a9487aa1b245bb"
CONTROL_PLANE_M26_ID = "vnext-pg17-desktop-device-revoke-authorization-lock-26"
CONTROL_PLANE_M26_SHA256 = "48bcfbdd3958d70a224ce807f4da1e23ce7142024a62913ce2e59b7eb8cd87cc"
CONTROL_PLANE_M27_ID = "vnext-pg17-family-member-canonical-role-27"
CONTROL_PLANE_M27_SHA256 = "297f705391d59c85733505e8b84e708ce33e4c90abb24a8a9231ad1bfc02de1c"


def verification_sql():
    count_queries = {
        "tenants": "SELECT count(*) FROM business.tenants",
        "institutions": "SELECT count(*) FROM business.institutions WHERE legacy_deleted=false",
        "schools": "SELECT count(*) FROM business.schools WHERE legacy_deleted=false",
        "rooms": "SELECT count(*) FROM business.rooms WHERE legacy_deleted=false",
        # Acceptance identities are explicitly named fixtures. They are needed
        # for repeatable role tests but must not change the historical import
        # inventory that gates a migration or deployment.
        "teachers": "SELECT count(*) FROM business.teachers WHERE legacy_deleted=false AND id NOT LIKE 'e2e-teacher-%'",
        "students": "SELECT count(*) FROM business.students WHERE legacy_deleted=false AND id NOT LIKE 'e2e-student-%'",
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
        "'taxonomySystemTable'",
        "to_regclass('business.question_taxonomy_systems') IS NOT NULL",
        "'taxonomyNodeTable'",
        "to_regclass('business.question_taxonomy_nodes') IS NOT NULL",
        "'taxonomyFunctions'",
        "to_regprocedure('business.vnext_create_question_taxonomy_system_v1(text,text,text,text,integer)') IS NOT NULL "
        "AND to_regprocedure('business.vnext_update_question_taxonomy_system_v1(text,text,timestamp with time zone,text,text,integer)') IS NOT NULL "
        "AND to_regprocedure('business.vnext_delete_question_taxonomy_system_v1(text,text,timestamp with time zone,integer)') IS NOT NULL "
        "AND to_regprocedure('business.vnext_create_question_taxonomy_node_v1(text,text,text,text,text,integer)') IS NOT NULL "
        "AND to_regprocedure('business.vnext_update_question_taxonomy_node_v1(text,text,timestamp with time zone,text,text,text,integer)') IS NOT NULL "
        "AND to_regprocedure('business.vnext_delete_question_taxonomy_node_v1(text,text,timestamp with time zone,text,integer)') IS NOT NULL",
        "'writerTaxonomyExecute'",
        "has_function_privilege('vnext_pg17_writer','business.vnext_create_question_taxonomy_node_v1(text,text,text,text,text,integer)','EXECUTE')",
        "'writerDirectTaxonomyInsert'",
        "has_table_privilege('vnext_pg17_writer','business.question_taxonomy_nodes','INSERT')",
        "'supplementalAuthorityTables'",
        "to_regclass('business.payments') IS NOT NULL AND to_regclass('business.consumptions') IS NOT NULL "
        "AND to_regclass('business.grades') IS NOT NULL AND to_regclass('business.personal_asset_manual_categories') IS NOT NULL "
        "AND to_regclass('business.personal_asset_manual_records') IS NOT NULL",
        "'writerSupplementalInsert'",
        "has_table_privilege('vnext_pg17_writer','business.payments','INSERT') "
        "AND has_table_privilege('vnext_pg17_writer','business.consumptions','INSERT') "
        "AND has_table_privilege('vnext_pg17_writer','business.grades','INSERT') "
        "AND has_table_privilege('vnext_pg17_writer','business.personal_asset_manual_records','INSERT')",
        "'runtimeSupplementalInsert'",
        "has_table_privilege('vnext_pg17_runtime','business.payments','INSERT') "
        "OR has_table_privilege('vnext_pg17_runtime','business.consumptions','INSERT') "
        "OR has_table_privilege('vnext_pg17_runtime','business.grades','INSERT') "
        "OR has_table_privilege('vnext_pg17_runtime','business.personal_asset_manual_records','INSERT')",
        "'readerSupplementalWrite'",
        "has_table_privilege('gewu_cloud_schedule_reader','business.payments','INSERT') "
        "OR has_table_privilege('gewu_cloud_schedule_reader','business.payments','UPDATE') "
        "OR has_table_privilege('gewu_cloud_schedule_reader','business.payments','DELETE')",
        "'runtimeProjectionRead'",
        "has_table_privilege('gewu_cloud_schedule_reader','business.students','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.student_contact_directory','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.teachers','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.courses','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.course_student_pricings','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.schedules','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.schedule_student_overrides','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.institutions','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.schools','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.rooms','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.grades','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.payments','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.consumptions','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.question_taxonomy_systems','SELECT') "
        "AND has_table_privilege('gewu_cloud_schedule_reader','business.question_taxonomy_nodes','SELECT')",
        "'runtimeCoreDirectWrite'",
        "has_table_privilege('gewu_cloud_schedule_reader','business.students','INSERT') "
        "OR has_table_privilege('gewu_cloud_schedule_reader','business.teachers','UPDATE') "
        "OR has_table_privilege('gewu_cloud_schedule_reader','business.courses','DELETE') "
        "OR has_table_privilege('gewu_cloud_schedule_reader','business.schedules','INSERT') "
        "OR has_table_privilege('gewu_cloud_schedule_reader','business.institutions','UPDATE')",
        "'controlPlaneM20'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_schema_migrations "
        f"WHERE migration_id='{CONTROL_PLANE_M20_ID}' AND semantic_version=20 AND manifest_sha256='{CONTROL_PLANE_M20_SHA256}')",
        "'controlPlaneM21'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_schema_migrations "
        f"WHERE migration_id='{CONTROL_PLANE_M21_ID}' AND semantic_version=21 AND manifest_sha256='{CONTROL_PLANE_M21_SHA256}')",
        "'desktopSessionReaderPrivileges'",
        "has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_authorities','SELECT') "
        "AND has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_accounts','SELECT') "
        "AND has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_trusted_devices','SELECT') "
        "AND has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_device_installations','SELECT') "
        "AND has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_account_device_links','SELECT') "
        "AND has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_sessions','SELECT') "
        "AND has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_role_grants','SELECT')",
        "'controlPlaneM22'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_schema_migrations "
        f"WHERE migration_id='{CONTROL_PLANE_M22_ID}' AND semantic_version=22 AND manifest_sha256='{CONTROL_PLANE_M22_SHA256}')",
        "'desktopCanonicalPhoneReader'",
        "has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_verified_contacts','SELECT')",
        "'controlPlaneM23'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_schema_migrations "
        f"WHERE migration_id='{CONTROL_PLANE_M23_ID}' AND semantic_version=23 AND manifest_sha256='{CONTROL_PLANE_M23_SHA256}')",
        "'desktopCloudSessionContracts'",
        "to_regclass('vnext_control_plane.vnext_desktop_session_challenges') IS NOT NULL "
        "AND has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_desktop_session_challenges','SELECT') "
        "AND NOT has_table_privilege('vnext_pg17_writer','vnext_control_plane.vnext_desktop_session_challenges','INSERT,UPDATE,DELETE') "
        "AND (SELECT count(*)=6 AND bool_and(has_function_privilege('vnext_pg17_writer',p.oid,'EXECUTE')) "
        "AND NOT bool_or(has_function_privilege('public',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
        "WHERE n.nspname='vnext_control_plane' AND p.proname IN ('vnext_start_desktop_session_challenge','vnext_exchange_desktop_session_challenge','vnext_read_desktop_session_installation','vnext_rotate_desktop_role_session','vnext_list_desktop_account_devices','vnext_revoke_desktop_device'))",
        "'controlPlaneM24'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_schema_migrations "
        f"WHERE migration_id='{CONTROL_PLANE_M24_ID}' AND semantic_version=24 AND manifest_sha256='{CONTROL_PLANE_M24_SHA256}')",
        "'desktopDeviceRevocationFixed'",
        "(SELECT position('fromvnext_control_plane.vnext_accountsasa' in normalized_definition)>0 "
        "AND position('a.status=''active''' in normalized_definition)>0 FROM ("
        "SELECT lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS normalized_definition "
        "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
        "WHERE n.nspname='vnext_control_plane' AND p.proname='vnext_revoke_desktop_device') AS target_function)",
        "'controlPlaneM25'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_schema_migrations "
        f"WHERE migration_id='{CONTROL_PLANE_M25_ID}' AND semantic_version=25 AND manifest_sha256='{CONTROL_PLANE_M25_SHA256}')",
        "'desktopSessionStartSourceLocked'",
        "(SELECT count(*)=1 AND bool_and("
        "position('fromvnext_control_plane.vnext_sessionss' in definition)>0 "
        "AND position('s.status=''active''' in definition)>0 "
        "AND position('s.expires_at>now_at' in definition)>0 "
        "AND position('au.status=''active''' in definition)>0 "
        "AND position('a.status=''active''' in definition)>0 "
        "AND position('d.status=''active''' in definition)>0 "
        "AND position('i.status=''active''' in definition)>0 "
        "AND position('l.status=''active''' in definition)>0 "
        "AND position('forshareofs' in definition)>0 "
        "AND position('row(s.account_auth_version,s.account_access_version,s.account_revocation_version,s.device_credential_version,s.device_risk_version,s.installation_credential_version,s.link_auth_version,s.link_access_version,s.link_row_version)=row(a.auth_version,a.access_version,a.revocation_version,d.credential_version,d.risk_version,i.credential_version,l.auth_version,l.access_version,l.row_version)' in definition)>0) "
        "FROM (SELECT lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS definition "
        "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vnext_control_plane' "
        "AND p.proname='vnext_start_desktop_session_challenge') AS start_function)",
        "'desktopSessionExchangeSourceLocked'",
        "(SELECT count(*)=1 AND bool_and("
        "position('source_sessionvnext_control_plane.vnext_sessions%rowtype' in definition)>0 "
        "AND position('fromvnext_control_plane.vnext_sessionsass' in definition)>0 "
        "AND position('source_session.status<>''active''' in definition)>0 "
        "AND position('source_session.expires_at<=now_at' in definition)>0 "
        "AND position('a.status<>''active''' in definition)>0 "
        "AND position('d.status<>''active''' in definition)>0 "
        "AND position('i.status<>''active''' in definition)>0 "
        "AND position('l.status<>''active''' in definition)>0 "
        "AND position('forupdate' in definition)>0 "
        "AND position('row(source_session.account_auth_version,source_session.account_access_version,source_session.account_revocation_version,source_session.device_credential_version,source_session.device_risk_version,source_session.installation_credential_version,source_session.link_auth_version,source_session.link_access_version,source_session.link_row_version)<>row(a.auth_version,a.access_version,a.revocation_version,d.credential_version,d.risk_version,i.credential_version,l.auth_version,l.access_version,l.row_version)' in definition)>0) "
        "FROM (SELECT lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS definition "
        "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vnext_control_plane' "
        "AND p.proname='vnext_exchange_desktop_session_challenge') AS exchange_function)",
        "'controlPlaneM26'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_schema_migrations "
        f"WHERE migration_id='{CONTROL_PLANE_M26_ID}' AND semantic_version=26 AND manifest_sha256='{CONTROL_PLANE_M26_SHA256}')",
        "'controlPlaneM27'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_schema_migrations "
        f"WHERE migration_id='{CONTROL_PLANE_M27_ID}' AND semantic_version=27 AND manifest_sha256='{CONTROL_PLANE_M27_SHA256}')",
        "'controlPlaneFamilyMemberRole'",
        "COALESCE((SELECT position('family_member' in pg_get_constraintdef(oid))>0 FROM pg_constraint "
        "WHERE conrelid='vnext_control_plane.vnext_role_grants'::regclass AND conname='vnext_role_grants_role_check'),false)",
        "'businessFamilyMemberRole'",
        "COALESCE((SELECT position('family_member' in pg_get_constraintdef(oid))>0 FROM pg_constraint "
        "WHERE conrelid='business.miniapp_cloud_role_grants'::regclass AND conname='miniapp_cloud_role_grants_role_check'),false)",
        "'businessFamilyMemberReviewV4'",
        "EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='business' "
        "AND p.proname='vnext_review_cloud_role_application_v4' AND has_function_privilege('vnext_pg17_identity_verifier',p.oid,'EXECUTE'))",
        "'desktopDeviceRevocationAuthorizationLocked'",
        "(SELECT count(*)=1 AND bool_and("
        "position('selects.*intoactor_sessionfromvnext_control_plane.vnext_sessionsass' in definition)>0 "
        "AND position('forupdate' in definition)>0 "
        "AND position('actor_session.status<>''active''' in definition)>0 "
        "AND position('actor_session.session_kind<>''online''' in definition)>0 "
        "AND position('actor_session.expires_at<=now_at' in definition)>0 "
        "AND position('selecta.*intoactor_accountfromvnext_control_plane.vnext_accountsasa' in definition)>0 "
        "AND position('vnext_desktop_actor_account_invalid' in definition)>0 "
        "AND position('selectd.*intoactor_devicefromvnext_control_plane.vnext_trusted_devicesasd' in definition)>0 "
        "AND position('selecti.*intoactor_installationfromvnext_control_plane.vnext_device_installationsasi' in definition)>0 "
        "AND position('selectl.*intoactor_linkfromvnext_control_plane.vnext_account_device_linksasl' in definition)>0 "
        "AND position('row(actor_session.account_auth_version,actor_session.account_access_version,actor_session.account_revocation_version,actor_session.device_credential_version,actor_session.device_risk_version,actor_session.installation_credential_version,actor_session.link_auth_version,actor_session.link_access_version,actor_session.link_row_version)<>row(actor_account.auth_version,actor_account.access_version,actor_account.revocation_version,actor_device.credential_version,actor_device.risk_version,actor_installation.credential_version,actor_link.auth_version,actor_link.access_version,actor_link.row_version)' in definition)>0 "
        "AND position('selectg.*intoactor_grantfromvnext_control_plane.vnext_role_grantsasg' in definition)>0 "
        "AND position('g.role=''super_admin''' in definition)>0 "
        "AND position('g.status=''active''' in definition)>0 "
        "AND position('g.starts_at<=now_at' in definition)>0 "
        "AND position('(g.ends_atisnullorg.ends_at>now_at)' in definition)>0 "
        "AND position('vnext_desktop_super_admin_required' in definition)>0 "
        "AND has_function_privilege('vnext_pg17_writer',function_oid,'EXECUTE') "
        "AND NOT has_function_privilege('public',function_oid,'EXECUTE')) "
        "FROM (SELECT p.oid AS function_oid,lower(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS definition "
        "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vnext_control_plane' "
        "AND p.proname='vnext_revoke_desktop_device') AS revoke_function)",
        "'oneActiveSuperAdmin'",
        "(SELECT count(*)=1 FROM vnext_control_plane.vnext_role_grants WHERE role='super_admin' AND status='active')",
        "'activeSuperAdminAccountId'",
        "(SELECT max(account_id) FROM vnext_control_plane.vnext_role_grants WHERE role='super_admin' AND status='active')",
        "'uniqueSuperAdminIndex'",
        "EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('vnext_control_plane.vnext_role_grants_one_active_super_admin') "
        "AND indisunique AND pg_get_expr(indpred,indrelid) LIKE '%super_admin%' AND pg_get_expr(indpred,indrelid) LIKE '%active%')",
        "'businessOneActiveSuperAdmin'",
        "(SELECT count(*)=1 FROM business.miniapp_cloud_role_grants WHERE role='super_admin' AND status='active')",
        "'businessActiveSuperAdminAccountId'",
        "(SELECT max(account_id) FROM business.miniapp_cloud_role_grants WHERE role='super_admin' AND status='active')",
        "'businessUniqueSuperAdminIndex'",
        "EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('business.miniapp_cloud_role_grants_one_active_super_admin') "
        "AND indisunique AND pg_get_expr(indpred,indrelid) LIKE '%super_admin%' AND pg_get_expr(indpred,indrelid) LIKE '%active%')",
    ))
    if len(fields) % 2 != 0:
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_VERIFICATION_QUERY_INVALID")
    rows = [
        f"({fields[index]},to_jsonb({fields[index + 1]}))"
        for index in range(0, len(fields), 2)
    ]
    return (
        "SELECT jsonb_object_agg(result_key,result_value)::text "
        "FROM (VALUES " + ",".join(rows) + ") AS verification(result_key,result_value)"
    )


def validate(payload):
    if not isinstance(payload, dict):
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_VERIFICATION_FAILED")
    for key, expected in EXPECTED_COUNTS.items():
        if payload.get(key) != expected:
            raise RuntimeError(f"CLOUD_BUSINESS_RELEASE_COUNT_MISMATCH:{key}:{payload.get(key)}:{expected}")
    required_functions = (
        "scheduleCreateFunction", "institutionCreateFunction", "schoolCreateFunction", "writerScheduleExecute",
        "taxonomySystemTable", "taxonomyNodeTable", "taxonomyFunctions", "writerTaxonomyExecute",
        "supplementalAuthorityTables", "writerSupplementalInsert",
        "runtimeProjectionRead",
    )
    missing_functions = [key for key in required_functions if payload.get(key) is not True]
    if missing_functions:
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_FUNCTION_MISSING:" + ",".join(missing_functions))
    denied_direct_writes = (
        "writerDirectScheduleInsert", "runtimeDirectScheduleInsert", "writerDirectTaxonomyInsert", "runtimeSupplementalInsert", "readerSupplementalWrite", "runtimeCoreDirectWrite",
    )
    open_direct_writes = [key for key in denied_direct_writes if payload.get(key) is not False]
    if open_direct_writes:
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_DIRECT_WRITE_OPEN:" + ",".join(open_direct_writes))
    required_account_invariants = (
        "controlPlaneM20", "controlPlaneM21", "desktopSessionReaderPrivileges", "controlPlaneM22", "desktopCanonicalPhoneReader",
        "controlPlaneM23", "desktopCloudSessionContracts", "controlPlaneM24", "desktopDeviceRevocationFixed",
        "controlPlaneM25", "desktopSessionStartSourceLocked", "desktopSessionExchangeSourceLocked",
        "controlPlaneM26", "controlPlaneM27", "controlPlaneFamilyMemberRole", "businessFamilyMemberRole", "businessFamilyMemberReviewV4",
        "desktopDeviceRevocationAuthorizationLocked",
        "oneActiveSuperAdmin", "uniqueSuperAdminIndex", "businessOneActiveSuperAdmin", "businessUniqueSuperAdminIndex", "fixedSuperAdminPhone",
    )
    failed_account_invariants = [key for key in required_account_invariants if payload.get(key) is not True]
    if failed_account_invariants:
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_ACCOUNT_ROLE_INVARIANT:" + ",".join(failed_account_invariants))
    return payload


def merge_fixed_admin(payload, fixed_admin):
    if not isinstance(payload, dict) or not isinstance(fixed_admin, dict) \
            or set(fixed_admin) != {"fixedSuperAdminAccountId"}:
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_VERIFICATION_FAILED")
    actual = payload.pop("activeSuperAdminAccountId", None)
    business_actual = payload.pop("businessActiveSuperAdminAccountId", None)
    expected = fixed_admin.get("fixedSuperAdminAccountId")
    if not all(isinstance(value, str) and value.strip() == value and value for value in (actual, business_actual, expected)):
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_VERIFICATION_FAILED")
    payload["fixedSuperAdminPhone"] = hmac.compare_digest(actual, expected) and hmac.compare_digest(business_actual, expected)
    return payload


def resolve_fixed_admin_silently(ssh):
    command = "docker exec gewu-cloud-business-api node scripts/verifyFixedSuperAdmin.js"
    _, stdout, stderr = ssh.exec_command(command, timeout=30)
    body = stdout.read().decode("utf-8")
    error = stderr.read().decode("utf-8")
    status = stdout.channel.recv_exit_status()
    if status != 0:
        raise RuntimeError("CLOUD_FIXED_SUPER_ADMIN_RESOLUTION_FAILED") from None
    try:
        value = json.loads(body)
    except json.JSONDecodeError as parse_error:
        raise RuntimeError("CLOUD_FIXED_SUPER_ADMIN_RESOLUTION_FAILED") from parse_error
    if error.strip() or not isinstance(value, dict):
        raise RuntimeError("CLOUD_FIXED_SUPER_ADMIN_RESOLUTION_FAILED")
    return value


def verify():
    ssh = deploy.connect()
    try:
        raw = DockerPsqlExecutor(ssh, "gewu-postgres17", "gewu_cloud", "gewu_app").run(verification_sql()).strip()
        fixed_admin = resolve_fixed_admin_silently(ssh)
    finally:
        ssh.close()
    try:
        payload = json.loads(raw)
        return validate(merge_fixed_admin(payload, fixed_admin))
    except json.JSONDecodeError as error:
        raise RuntimeError("CLOUD_BUSINESS_RELEASE_VERIFICATION_FAILED") from error


if __name__ == "__main__":
    print(json.dumps(verify(), sort_keys=True))
