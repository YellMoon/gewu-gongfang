import unittest
from legacy_export_interruption import interruption_sql, validate_plan, REVIEWED_TASK_ID

PLAN = {'taskId': REVIEWED_TASK_ID, 'tenantId':'tenant', 'accountId':'account',
        'updatedAt':'2026-09-12T21:24:43.107667+00:00', 'bootEpoch':1789262242,
        'requestHash':'a'*64, 'snapshotMd5':'b'*32}


class LegacyExportInterruptionTests(unittest.TestCase):
    def test_only_the_reviewed_task_with_a_pre_boot_baseline_is_accepted(self):
        self.assertEqual(validate_plan(PLAN), PLAN)
        for invalid in ({**PLAN,'taskId':'paper_task_unreviewed'}, {**PLAN,'bootEpoch':0},
                        {**PLAN,'updatedAt':'2026-09-12T21:24:43'},
                        {**PLAN,'requestHash':"';UPDATE other"}, {**PLAN,'extra':True}):
            with self.assertRaisesRegex(ValueError, 'LEGACY_EXPORT_REVIEW_INVALID'):
                validate_plan(invalid)

    def test_compare_and_set_never_requeues_or_changes_snapshots(self):
        sql=interruption_sql(PLAN)
        for condition in ('claim_token IS NULL','lease_expires_at IS NULL','result_artifact_id IS NULL',
                          "status='processing'", "phase='rendering'", 'request_hash=',
                          'md5(question_snapshot_json::text)=', 'updated_at=', 'updated_at<to_timestamp('):
            self.assertIn(condition,sql)
        self.assertIn("SET status='failed',phase='failed',error_code='CLOUD_PAPER_EXPORT_INTERRUPTED'",sql)
        self.assertNotIn("status='queued'",sql)
        self.assertNotIn('SET question_snapshot_json',sql)


if __name__=='__main__':
    unittest.main()
