"""UTF-8: exact recovery of refresh snapshots and disposable fixture protection."""
import copy
import unittest
from unittest.mock import patch
from business_parity_course_refresh import seed_course_refresh, verify_course_refresh_history

class RefreshHistoryTest(unittest.TestCase):
    def test_exact_undo_and_outside_range(self):
        before={'schedules':[{'id':key,'updated_at':'old','notes':'original'} for key in ['first','late','early','next']],
                'students':[{'id':'student'}],'courses':[{'id':'course'}], 'schedule_student_overrides':[{'tuition':180,'attendance_status':4}],
                'payments':[{'amount':500}],'consumptions':[{'amount':50}]}
        after=copy.deepcopy(before)
        for row in after['schedules'][:2]: row['updated_at']='new'
        self.assertTrue(verify_course_refresh_history(before,after,['first','late'])['undoRestoredOriginalSnapshots'])
        for key in before:
            bad=copy.deepcopy(after);bad[key][0]['unexpected']='drift'
            with self.subTest(key=key),self.assertRaises(RuntimeError):verify_course_refresh_history(before,bad,['first','late'])
        for index in [0,2]:
            bad=copy.deepcopy(after);bad['schedules'][index]['updated_at']='changed' if index==2 else 'old'
            with self.assertRaises(RuntimeError):verify_course_refresh_history(before,bad,['first','late'])
        with self.assertRaises(RuntimeError):verify_course_refresh_history(before,after,['missing'])

    def test_no_fixture_writes_outside_shadow(self):
        class Db:
            def run(self,sql):
                if sql!='SELECT current_database()':raise AssertionError('unexpected write')
                return 'gewu_cloud'
        for name in ['gewu_cloud','gewu_ui_shadow_'+'a'*16]:
            with self.assertRaises(RuntimeError):seed_course_refresh(Db(),name)

    def test_exact_ids_and_date_boundaries(self):
        class Db:
            calls=[]
            def run(self,sql):
                self.calls.append(sql);return 'gewu_ui_shadow_'+'a'*16
        db=Db()
        with patch('business_parity_course_refresh.seed_student_history',return_value={'studentId':'fixture'}):
            result=seed_course_refresh(db,'gewu_ui_shadow_'+'a'*16)
        self.assertEqual(result['refreshIds'],['fixture','fixture-late'])
        self.assertEqual(result['outsideIds'],['fixture-early','fixture-next'])
        self.assertIn('IF current_database()<>',db.calls[-1]);self.assertIn('2026-09-08T15:00:00Z',db.calls[-1])

if __name__=='__main__':unittest.main()
