"""UTF-8: finish/reopen may advance only the target course version after returning to active."""
import copy
import unittest
from unittest.mock import patch
from business_parity_course_active import seed_course_active, verify_course_active_history

class CourseActiveHistoryTest(unittest.TestCase):
    def test_exact_restored_course_and_history(self):
        before={'courses':[{'id':'course','legacy_active':True,'updated_at':'old','year':None}],
                'student':{'id':'student','legacy_deleted':True},'schedules':[{'id':'lesson','status':1}],
                'course_student_pricings':[{'tuition':123}],'payments':[{'amount':500}],'consumptions':[{'amount':50}]}
        after=copy.deepcopy(before);after['courses'][0]['updated_at']='new'
        self.assertTrue(verify_course_active_history(before,after,'course')['historyUnchanged'])
        for key in before:
            bad=copy.deepcopy(after)
            (bad[key] if isinstance(bad[key],dict) else bad[key][0])['drift']=True
            with self.subTest(key=key),self.assertRaises(RuntimeError):verify_course_active_history(before,bad,'course')
        for value in [False,None]:
            bad=copy.deepcopy(after);bad['courses'][0]['legacy_active']=value
            with self.assertRaises(RuntimeError):verify_course_active_history(before,bad,'course')
        with self.assertRaises(RuntimeError):verify_course_active_history(before,before,'course')
        with self.assertRaises(RuntimeError):verify_course_active_history(before,after,'missing')

    def test_no_fixture_outside_disposable_database(self):
        class Db:
            def run(self,sql):
                if sql!='SELECT current_database()':raise AssertionError('unexpected write')
                return 'gewu_cloud'
        with patch('business_parity_course_active.seed_student_history') as seed:
            for target in ['gewu_cloud','gewu_ui_shadow_'+'a'*16]:
                with self.assertRaises(RuntimeError):seed_course_active(Db(),target)
            seed.assert_not_called()

    def test_fixture_preserves_course_and_archives_only_its_student(self):
        class Db:
            calls=[]
            def run(self,sql):self.calls.append(sql);return 'gewu_ui_shadow_'+'a'*16
        db=Db()
        with patch('business_parity_course_active.seed_student_history',return_value={'studentId':'fixture'}) as seed:
            result=seed_course_active(db,'gewu_ui_shadow_'+'a'*16)
            seed.assert_called_once_with(db,'gewu_ui_shadow_'+'a'*16,parents_deleted=False)
        self.assertEqual(result['studentId'],'fixture');self.assertIn('IF current_database()<>',db.calls[-1])
        self.assertIn("WHERE id='fixture'",db.calls[-1]);self.assertNotIn('UPDATE business.courses',db.calls[-1])

if __name__=='__main__':unittest.main()
