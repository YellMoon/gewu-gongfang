"""Reviewed one-off recovery SQL; never called by the normal task worker.

The operator must first record fresh boot evidence and a restore-verified backup.
The query itself only closes the reviewed, unowned, pre-boot task by exact CAS.
"""
import datetime
import re

REVIEWED_TASK_ID='paper_task_0fc7a87e-58f8-4e63-9326-0feed210c433'
KEYS={'taskId','tenantId','accountId','updatedAt','bootEpoch','requestHash','snapshotMd5'}


def validate_plan(plan):
    valid=isinstance(plan,dict) and set(plan)==KEYS and plan.get('taskId')==REVIEWED_TASK_ID
    valid=valid and all(isinstance(plan.get(k),str) and 0<len(plan[k])<=160 and '\x00' not in plan[k]
                        for k in ('tenantId','accountId'))
    valid=valid and bool(re.fullmatch('[a-f0-9]{64}',str(plan.get('requestHash',''))))
    valid=valid and bool(re.fullmatch('[a-f0-9]{32}',str(plan.get('snapshotMd5',''))))
    valid=valid and type(plan.get('bootEpoch')) is int and 0<plan['bootEpoch']<4102444800
    try:
        before=datetime.datetime.fromisoformat(plan['updatedAt'])
        valid=valid and before.tzinfo is not None and before.timestamp()<plan['bootEpoch']
    except (TypeError,ValueError,KeyError):
        valid=False
    if not valid:
        raise ValueError('LEGACY_EXPORT_REVIEW_INVALID')
    return dict(plan)


def literal(value):
    return "'"+value.replace("'","''")+"'"


def interruption_sql(plan):
    p=validate_plan(plan)
    return (
        "UPDATE business.paper_export_tasks "
        "SET status='failed',phase='failed',error_code='CLOUD_PAPER_EXPORT_INTERRUPTED',updated_at=clock_timestamp() "
        f"WHERE task_id={literal(p['taskId'])} AND tenant_id={literal(p['tenantId'])} AND account_id={literal(p['accountId'])} "
        "AND status='processing' AND phase='rendering' AND claim_token IS NULL AND lease_expires_at IS NULL "
        "AND result_artifact_id IS NULL "
        f"AND updated_at={literal(p['updatedAt'])}::timestamptz AND updated_at<to_timestamp({p['bootEpoch']}) "
        f"AND request_hash={literal(p['requestHash'])} AND md5(question_snapshot_json::text)={literal(p['snapshotMd5'])} "
        "RETURNING json_build_object('taskId',task_id,'status',status,'phase',phase,'errorCode',error_code,"
        "'updatedAt',updated_at,'requestHash',request_hash,'snapshotMd5',md5(question_snapshot_json::text))::text;"
    )
