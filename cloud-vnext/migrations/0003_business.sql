begin;

create table if not exists business.institutions (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.institutions(tenant_id)
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_institutions_tenant_id_idx on business.institutions (tenant_id);

create table if not exists business.schools (
  id text primary key,
  institution_id text not null references business.institutions(id), -- fk-index: business.schools(institution_id)
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  row_version bigint not null default 1
);
create index if not exists business_schools_institution_id_idx on business.schools (institution_id);

create table if not exists business.rooms (
  id text primary key,
  institution_id text not null references business.institutions(id), -- fk-index: business.rooms(institution_id)
  name text not null,
  capacity bigint check (capacity is null or capacity >= 0),
  status text not null default 'active' check (status in ('active','archived')),
  row_version bigint not null default 1
);
create index if not exists business_rooms_institution_id_idx on business.rooms (institution_id);

create table if not exists business.subjects (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.subjects(tenant_id)
  name text not null,
  status text not null default 'active',
  unique(tenant_id, name)
);
create index if not exists business_subjects_tenant_id_idx on business.subjects (tenant_id);

create table if not exists business.teachers (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.teachers(tenant_id)
  profile_id text references identity.profiles(id), -- fk-index: business.teachers(profile_id)
  institution_id text references business.institutions(id), -- fk-index: business.teachers(institution_id)
  name text not null,
  status text not null default 'active' check (status in ('pending_match','active','merged','archived')),
  row_version bigint not null default 1
);
create index if not exists business_teachers_tenant_id_idx on business.teachers (tenant_id);
create index if not exists business_teachers_profile_id_idx on business.teachers (profile_id);
create index if not exists business_teachers_institution_id_idx on business.teachers (institution_id);

create table if not exists business.students (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.students(tenant_id)
  profile_id text references identity.profiles(id), -- fk-index: business.students(profile_id)
  school_id text references business.schools(id), -- fk-index: business.students(school_id)
  name text not null,
  status text not null default 'active' check (status in ('pending_match','active','graduated','merged','archived')),
  row_version bigint not null default 1
);
create index if not exists business_students_tenant_id_idx on business.students (tenant_id);
create index if not exists business_students_profile_id_idx on business.students (profile_id);
create index if not exists business_students_school_id_idx on business.students (school_id);

create table if not exists business.guardian_students (
  guardian_profile_id text not null references identity.profiles(id), -- fk-index: business.guardian_students(guardian_profile_id)
  student_id text not null references business.students(id), -- fk-index: business.guardian_students(student_id)
  relationship text not null,
  status text not null default 'active' check (status in ('pending','active','revoked')),
  primary key(guardian_profile_id, student_id)
);
create index if not exists business_guardian_students_guardian_profile_id_idx on business.guardian_students (guardian_profile_id);
create index if not exists business_guardian_students_student_id_idx on business.guardian_students (student_id);

create table if not exists business.courses (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.courses(tenant_id)
  institution_id text references business.institutions(id), -- fk-index: business.courses(institution_id)
  subject_id text references business.subjects(id), -- fk-index: business.courses(subject_id)
  teacher_id text references business.teachers(id), -- fk-index: business.courses(teacher_id)
  name text not null,
  unit_price numeric(20, 4) check (unit_price is null or unit_price >= 0),
  status text not null default 'active' check (status in ('draft','active','completed','archived')),
  row_version bigint not null default 1
);
create index if not exists business_courses_tenant_id_idx on business.courses (tenant_id);
create index if not exists business_courses_institution_id_idx on business.courses (institution_id);
create index if not exists business_courses_subject_id_idx on business.courses (subject_id);
create index if not exists business_courses_teacher_id_idx on business.courses (teacher_id);

create table if not exists business.enrollments (
  id text primary key,
  course_id text not null references business.courses(id), -- fk-index: business.enrollments(course_id)
  student_id text not null references business.students(id), -- fk-index: business.enrollments(student_id)
  status text not null check (status in ('pending','active','paused','completed','cancelled')),
  enrolled_at timestamptz,
  row_version bigint not null default 1,
  unique(course_id, student_id)
);
create index if not exists business_enrollments_course_id_idx on business.enrollments (course_id);
create index if not exists business_enrollments_student_id_idx on business.enrollments (student_id);

create table if not exists business.schedules (
  id text primary key,
  course_id text not null references business.courses(id), -- fk-index: business.schedules(course_id)
  room_id text references business.rooms(id), -- fk-index: business.schedules(room_id)
  teacher_id text references business.teachers(id), -- fk-index: business.schedules(teacher_id)
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  planned_hours numeric(20, 4) not null check (planned_hours >= 0),
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  row_version bigint not null default 1
);
create index if not exists business_schedules_course_id_idx on business.schedules (course_id);
create index if not exists business_schedules_room_id_idx on business.schedules (room_id);
create index if not exists business_schedules_teacher_id_idx on business.schedules (teacher_id);

create table if not exists business.schedule_students (
  schedule_id text not null references business.schedules(id), -- fk-index: business.schedule_students(schedule_id)
  student_id text not null references business.students(id), -- fk-index: business.schedule_students(student_id)
  attendance_status text not null default 'expected' check (attendance_status in ('expected','present','absent','leave')),
  primary key(schedule_id, student_id)
);
create index if not exists business_schedule_students_schedule_id_idx on business.schedule_students (schedule_id);
create index if not exists business_schedule_students_student_id_idx on business.schedule_students (student_id);

create table if not exists business.payments (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.payments(tenant_id)
  student_id text not null references business.students(id), -- fk-index: business.payments(student_id)
  course_id text references business.courses(id), -- fk-index: business.payments(course_id)
  amount numeric(20, 4) not null,
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz,
  status text not null check (status in ('pending','confirmed','refunded','void')),
  row_version bigint not null default 1
);
create index if not exists business_payments_tenant_id_idx on business.payments (tenant_id);
create index if not exists business_payments_student_id_idx on business.payments (student_id);
create index if not exists business_payments_course_id_idx on business.payments (course_id);

create table if not exists business.consumptions (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.consumptions(tenant_id)
  student_id text not null references business.students(id), -- fk-index: business.consumptions(student_id)
  course_id text references business.courses(id), -- fk-index: business.consumptions(course_id)
  schedule_id text references business.schedules(id), -- fk-index: business.consumptions(schedule_id)
  consumed_hours numeric(20, 4) not null check (consumed_hours >= 0),
  consumed_amount numeric(20, 4) not null,
  consumed_at timestamptz not null,
  status text not null check (status in ('confirmed','reversed')),
  row_version bigint not null default 1
);
create index if not exists business_consumptions_tenant_id_idx on business.consumptions (tenant_id);
create index if not exists business_consumptions_student_id_idx on business.consumptions (student_id);
create index if not exists business_consumptions_course_id_idx on business.consumptions (course_id);
create index if not exists business_consumptions_schedule_id_idx on business.consumptions (schedule_id);

create table if not exists business.grades (
  id text primary key,
  student_id text not null references business.students(id), -- fk-index: business.grades(student_id)
  course_id text references business.courses(id), -- fk-index: business.grades(course_id)
  grade_value numeric(20, 4),
  grade_text text,
  recorded_at timestamptz not null default now(),
  row_version bigint not null default 1
);
create index if not exists business_grades_student_id_idx on business.grades (student_id);
create index if not exists business_grades_course_id_idx on business.grades (course_id);

create table if not exists business.asset_accounts (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.asset_accounts(tenant_id)
  owner_account_id text not null references identity.accounts(id), -- fk-index: business.asset_accounts(owner_account_id)
  name text not null,
  currency text not null default 'CNY',
  opening_balance numeric(20, 4) not null default 0,
  status text not null default 'active' check (status in ('active','closed','archived')),
  row_version bigint not null default 1
);
create index if not exists business_asset_accounts_tenant_id_idx on business.asset_accounts (tenant_id);
create index if not exists business_asset_accounts_owner_account_id_idx on business.asset_accounts (owner_account_id);

create table if not exists business.personal_asset_categories (
  id text primary key,
  tenant_id text not null references identity.tenants(id), -- fk-index: business.personal_asset_categories(tenant_id)
  owner_account_id text not null references identity.accounts(id), -- fk-index: business.personal_asset_categories(owner_account_id)
  name text not null,
  unique(owner_account_id, name)
);
create index if not exists business_personal_asset_categories_tenant_id_idx on business.personal_asset_categories (tenant_id);
create index if not exists business_personal_asset_categories_owner_account_id_idx on business.personal_asset_categories (owner_account_id);

create table if not exists business.personal_asset_records (
  id text primary key,
  asset_account_id text not null references business.asset_accounts(id), -- fk-index: business.personal_asset_records(asset_account_id)
  category_id text references business.personal_asset_categories(id), -- fk-index: business.personal_asset_records(category_id)
  owner_account_id text not null references identity.accounts(id), -- fk-index: business.personal_asset_records(owner_account_id)
  amount numeric(20, 4) not null,
  occurred_at timestamptz not null,
  description text,
  row_version bigint not null default 1
);
create index if not exists business_personal_asset_records_asset_account_id_idx on business.personal_asset_records (asset_account_id);
create index if not exists business_personal_asset_records_category_id_idx on business.personal_asset_records (category_id);
create index if not exists business_personal_asset_records_owner_account_id_idx on business.personal_asset_records (owner_account_id);

commit;
