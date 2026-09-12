"""UTF-8: disposable old course and exact state restoration checks, never production."""
import copy
import re
from apply_cloud_postgres_migrations import sql_literal
from business_parity_student_history import seed_student_history

def seed_course_active(db,target):
    if not re.fullmatch(r'gewu_ui_shadow_[a-f0-9]{16}',target) or db.run('SELECT current_database()').strip()!=target:
        raise RuntimeError('ISOLATED_SHADOW_REQUIRED')
    fixture=seed_student_history(db,target,parents_deleted=False)
    db.run("BEGIN; SET LOCAL ROLE vnext_pg17_business_owner; DO $$ BEGIN IF current_database()<>"+sql_literal(target)+
           " THEN RAISE EXCEPTION 'ISOLATED_SHADOW_REQUIRED'; END IF; END $$; UPDATE business.students SET legacy_deleted=true WHERE id="+
           sql_literal(fixture['studentId'])+"; COMMIT;")
    return fixture

def verify_course_active_history(before,after,course_id):
    courses=before.get('courses',[])
    if len(courses)!=1 or courses[0].get('id')!=course_id or courses[0].get('legacy_active') is not True:
        raise RuntimeError('COURSE_ACTIVE_BASELINE_INVALID')
    final=after.get('courses',[])
    if len(final)!=1 or not final[0].get('updated_at') or final[0]['updated_at']==courses[0].get('updated_at'):
        raise RuntimeError('COURSE_ACTIVE_VERSION_UNCHANGED')
    expected=copy.deepcopy(before);expected['courses'][0]['updated_at']=final[0]['updated_at']
    if after!=expected:raise RuntimeError('COURSE_ACTIVE_HISTORY_DRIFT')
    return {'originalActiveRestored':True,'historyUnchanged':True,'onlyCourseVersionChanged':True}
