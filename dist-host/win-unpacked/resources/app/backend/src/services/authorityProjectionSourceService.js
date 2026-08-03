function sourceError(code) {
  return Object.assign(new Error(code), { code });
}

function createAuthorityProjectionSourceService({
  db,
  tenantId = 'default',
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw sourceError('AUTHORITY_PROJECTION_SOURCE_DATABASE_REQUIRED');
  }
  const tenant = String(tenantId || '').trim();
  if (!tenant) throw sourceError('AUTHORITY_PROJECTION_SOURCE_TENANT_REQUIRED');

  const readAuthority = db.prepare(
    "SELECT value FROM authority_metadata WHERE key='database_authority_id'"
  );
  const readCourses = db.prepare(`SELECT * FROM courses
    WHERE tenant_id=? AND deleted=0 ORDER BY created_at DESC,id`);
  const readSchedules = db.prepare(`SELECT * FROM schedules
    WHERE tenant_id=? AND deleted=0 ORDER BY start_time DESC,id`);
  const readQuestionPreviews = db.prepare(`SELECT
      q.id,
      q.type,
      q.subject,
      q.difficulty,
      substr(COALESCE((
        SELECT qc.stem
        FROM question_contents qc
        WHERE qc.question_id=q.id AND qc.tenant_id=q.tenant_id AND qc.deleted=0
        ORDER BY qc.version DESC,qc.updated_at DESC,qc.id DESC
        LIMIT 1
      ),''),1,240) AS stemPreview
    FROM questions q
    WHERE q.tenant_id=? AND q.deleted=0 AND q.storage_state='host_committed'
    ORDER BY q.updated_at DESC,q.id`);
  const readQuestions = db.prepare(`SELECT
      q.*,
      qc.stem AS content,
      qc.stem,
      qc.answer,
      qc.explanation,
      qc.options_json,
      qc.rich_content_json
    FROM questions q
    LEFT JOIN question_contents qc ON qc.id=(
      SELECT latest.id
      FROM question_contents latest
      WHERE latest.question_id=q.id AND latest.tenant_id=q.tenant_id
        AND latest.deleted=0
      ORDER BY latest.version DESC,latest.updated_at DESC,latest.id DESC
      LIMIT 1
    )
    WHERE q.tenant_id=? AND q.deleted=0 AND q.storage_state='host_committed'
    ORDER BY q.updated_at DESC,q.id`);
  const readStudents = db.prepare(`SELECT * FROM students
    WHERE tenant_id=? AND deleted=0 ORDER BY created_at DESC,id`);
  const readGrades = db.prepare(`SELECT * FROM grades
    WHERE tenant_id=? AND deleted=0 ORDER BY created_at DESC,id`);
  const readEnrollments = db.prepare(`SELECT * FROM enrollments
    WHERE tenant_id=? AND deleted=0 ORDER BY created_at DESC,id`);
  const readPayments = db.prepare(`SELECT * FROM payments
    WHERE tenant_id=? AND deleted=0 ORDER BY payment_date DESC,id`);
  const readConsumptions = db.prepare(`SELECT * FROM consumptions
    WHERE tenant_id=? AND deleted=0 ORDER BY consumption_date DESC,id`);
  const readTeachers = db.prepare(`SELECT * FROM teachers
    WHERE tenant_id=? AND deleted=0 ORDER BY created_at DESC,id`);
  const readRooms = db.prepare(`SELECT * FROM rooms
    WHERE tenant_id=? AND deleted=0 ORDER BY created_at DESC,id`);
  const readInstitutions = db.prepare(`SELECT * FROM institutions
    WHERE tenant_id=? AND deleted=0 ORDER BY created_at DESC,id`);
  const readSchools = db.prepare(`SELECT * FROM schools
    WHERE tenant_id=? AND deleted=0 ORDER BY name,id`);
  const readTaxonomySystems = db.prepare(`SELECT * FROM taxonomy_systems
    WHERE tenant_id=? AND deleted=0 ORDER BY sort_order,name,id`);
  const readTaxonomyNodes = db.prepare(`SELECT * FROM taxonomy_nodes
    WHERE tenant_id=? AND deleted=0 ORDER BY system_id,sort_order,name,id`);
  const readAssets = db.prepare(`SELECT
      account_id AS id,
      owner_user_id AS ownerUserId,
      account_type AS accountType,
      provider,
      label,
      masked_identifier AS maskedIdentifier,
      balance,
      currency
    FROM asset_accounts
    WHERE authority_id=? AND status='active'
    ORDER BY account_id`);
  const readAssetRecords = db.prepare(`SELECT
      record_id AS id,
      authority_id AS authorityId,
      owner_user_id AS ownerUserId,
      account_id AS accountId,
      record_date AS date,
      record_type AS type,
      category_id AS categoryId,
      category_name AS categoryName,
      amount,
      student_id AS studentId,
      student_name AS studentName,
      note,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM personal_asset_records
    WHERE authority_id=? AND status='active'
    ORDER BY record_date,record_id`);
  const readAssetCategories = db.prepare(`SELECT
      category_id AS id,
      authority_id AS authorityId,
      owner_user_id AS ownerUserId,
      name,
      category_type AS type,
      color,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM personal_asset_categories
    WHERE authority_id=? AND status='active'
    ORDER BY category_type,name,category_id`);
  const readRoleApplications = db.prepare(`SELECT
      application_id AS applicationId,
      authority_id AS authorityId,
      user_id AS userId,
      requested_role AS requestedRole,
      binding_hint AS bindingHint,
      status,
      reviewed_by AS reviewedBy,
      reviewed_at AS reviewedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM authority_role_applications
    WHERE authority_id=?
    ORDER BY created_at,application_id`);
  const readRoleGrants = db.prepare(`SELECT
      binding_id AS bindingId,
      authority_id AS authorityId,
      user_id AS userId,
      role,
      subject_type AS subjectType,
      subject_id AS subjectId,
      status,
      grant_version AS grantVersion,
      granted_by AS grantedBy,
      created_at AS createdAt,
      updated_at AS updatedAt,
      revoked_at AS revokedAt
    FROM authority_role_bindings
    WHERE authority_id=?
    ORDER BY user_id,role,binding_id`);

  function load({ authorityId } = {}) {
    const authority = String(authorityId || '').trim();
    if (!authority) throw sourceError('AUTHORITY_PROJECTION_SOURCE_AUTHORITY_REQUIRED');
    const localAuthority = String(readAuthority.get()?.value || '').trim();
    if (!localAuthority || localAuthority !== authority) {
      throw sourceError('AUTHORITY_PROJECTION_SOURCE_AUTHORITY_MISMATCH');
    }
    return Object.freeze({
      students: Object.freeze(readStudents.all(tenant)),
      grades: Object.freeze(readGrades.all(tenant)),
      enrollments: Object.freeze(readEnrollments.all(tenant)),
      courses: Object.freeze(readCourses.all(tenant)),
      schedules: Object.freeze(readSchedules.all(tenant)),
      payments: Object.freeze(readPayments.all(tenant)),
      consumptions: Object.freeze(readConsumptions.all(tenant)),
      teachers: Object.freeze(readTeachers.all(tenant)),
      rooms: Object.freeze(readRooms.all(tenant)),
      institutions: Object.freeze(readInstitutions.all(tenant)),
      schools: Object.freeze(readSchools.all(tenant)),
      questions: Object.freeze(readQuestions.all(tenant)),
      questionPreviews: Object.freeze(readQuestionPreviews.all(tenant)),
      taxonomySystems: Object.freeze(readTaxonomySystems.all(tenant)),
      taxonomyNodes: Object.freeze(readTaxonomyNodes.all(tenant)),
      assets: Object.freeze(readAssets.all(authority)),
      assetRecords: Object.freeze(readAssetRecords.all(authority)),
      assetCategories: Object.freeze(readAssetCategories.all(authority)),
      roleApplications: Object.freeze(readRoleApplications.all(authority)),
      roleGrants: Object.freeze(readRoleGrants.all(authority)),
    });
  }

  return Object.freeze({ load });
}

module.exports = {
  createAuthorityProjectionSourceService,
  sourceError,
};
