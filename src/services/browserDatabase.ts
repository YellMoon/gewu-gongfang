// 数据库服务层 v1.3 - 支持学生来源、学校存储、课程状态
import { 
  Student, Grade, Course, Schedule, Enrollment, Payment, Consumption, Institution, SchoolInfo, Teacher, Room,
  ScheduleStatus, PaymentType, BillingUnit, TeacherFeeMode, ServiceType, StudentSource,
  RevenueStats, StudentTuitionStats, StudentCoursePricing,
  AssetRecord, AssetCategory, AssetStats, Question, KnowledgeNode, Tag, QuestionTagRel, TagType,
  QuestionVersion, ImportTask, ImportTaskItem, ImportTaskStatus, ImportTaskItemStatus, TaxonomySystem
} from '../types';
import type { SyncAction, SyncTable } from './syncEngine';
import { applyTrustedQuestionProvenance } from './questionProvenance.mjs';
import { calculateGrade, calculateFees, calculateDurationHours, groupByMonth, calculatePercentage } from '../utils/helpers';
import { getColorForRoom } from '../utils/courseColors';
import {
  makeQuestionTagRelId,
  normalizeQuestionTagRels,
  relsFromQuestionLegacyIds,
  tagsToLegacyTree,
  upsertLegacyTreeTags,
} from './tagAdapter';
import { normalizeQuestionType } from '../constants/questionTypes';
import { cacheQuestionTrees, clearQuestionLocalStore, removeQuestionLocalRecord, upsertQuestionLocalRecord } from './questionLocalStore';
import { applyQuestionSyncRecords, buildBrowserQuestionSearchText, mergeBrowserQuestionUpdate, normalizeBrowserQuestionRecord } from './questionRichContent';
import { projectDesktopCacheForIdentity } from './desktopCacheProjection.mjs';
import { readDesktopAuthorizationSession } from './desktopAuthorizationSession.mjs';
import { createAuthorityDraftFromLocalMutation } from './authorityDraftAdapter.mjs';
import { createAuthorityCacheCheckpoint } from './authorityCacheCheckpoint.mjs';
import { buildAuthorityBackedBrowserCache } from './authorityProjectionCacheAdapter.mjs';
import {
  partitionedStorageKey,
  migrateLegacyStorageValue,
  readCurrentDesktopIdentityContext,
  readCurrentDesktopIdentityPartition,
  setCurrentDesktopIdentityPartition,
} from './desktopIdentityPartition.mjs';

interface Database {
  students: Student[];
  student_contacts: any[];
  grades: Grade[];
  courses: Course[];
  schedules: Schedule[];
  enrollments: Enrollment[];
  payments: Payment[];
  consumptions: Consumption[];
  institutions: Institution[];
  schools: SchoolInfo[];
  rooms: Room[];
  teachers: Teacher[];
  assetRecords: AssetRecord[];
  assetCategories: AssetCategory[];
  questions: Question[];
  knowledgeTree: KnowledgeNode[];
  modelTree: KnowledgeNode[];
  taxonomySystems: TaxonomySystem[];
  taxonomyInitialized: boolean;
  taxonomy_systems: any[];
  taxonomy_nodes: any[];
  tags: Tag[];
  questionTagRels: QuestionTagRel[];
  questionBasketIds: string[];
  questionVersions: QuestionVersion[];
  importTasks: ImportTask[];
  importTaskItems: ImportTaskItem[];
}

type SyncLocalDataMaps = Partial<Record<SyncTable, Map<string, any>>>;

const SYNC_TABLES: SyncTable[] = [
  'students',
  'courses',
  'schedules',
  'payments',
  'consumptions',
  'teachers',
  'grades',
  'rooms',
  'institutions',
  'assetRecords',
  'questions',
  'assetCategories',
  'taxonomy_systems',
  'taxonomy_nodes',
];

const QUESTION_VERSION_LIMIT = 20;
const BUSINESS_DATA_SAFETY_BACKUP_KEY = 'business_data_safety_backups_v1';
const BUSINESS_DATA_SAFETY_BACKUP_LIMIT = 20;
const TAXONOMY_DELETION_BACKUP_KEY = 'taxonomy_deletion_backups_v1';
const TAXONOMY_DELETION_BACKUP_LIMIT = 50;

function emptyDatabase(): Database {
  return {
    students: [],
    student_contacts: [],
    grades: [],
    courses: [],
    schedules: [],
    enrollments: [],
    payments: [],
    consumptions: [],
    assetRecords: [],
    assetCategories: [],
    questions: [],
    knowledgeTree: [],
    modelTree: [],
    taxonomySystems: [],
    taxonomyInitialized: false,
    taxonomy_systems: [],
    taxonomy_nodes: [],
    tags: [],
    questionTagRels: [],
    questionBasketIds: [],
    questionVersions: [],
    importTasks: [],
    importTaskItems: [],
    institutions: [],
    schools: [],
    rooms: [],
    teachers: [],
  };
}

class BrowserDatabaseService {
  private partitionKey = readCurrentDesktopIdentityPartition();
  private storageKey = partitionedStorageKey('scheduling_system_db_v3');
  private questionSearchIndex = new Map<string, string>();
  private data: Database = emptyDatabase();
  private authorityCacheCheckpoint = createAuthorityCacheCheckpoint(this.data);

  constructor() {
    this.loadData();
  }

  private identityStorageKey(baseKey: string): string {
    return partitionedStorageKey(baseKey);
  }

  public prepareIdentityPartitionChange(): void {
    this.data = emptyDatabase();
    this.questionSearchIndex.clear();
    this.authorityCacheCheckpoint.commit(this.data);
  }

  public switchIdentityPartition(partitionKey: string): void {
    setCurrentDesktopIdentityPartition(partitionKey);
    this.partitionKey = readCurrentDesktopIdentityPartition();
    this.storageKey = partitionedStorageKey('scheduling_system_db_v3');
    this.prepareIdentityPartitionChange();
    this.loadData();
    void this.refreshAuthorityProjection().catch(error => {
      window.dispatchEvent(new CustomEvent('authority-projection-refresh-failed', {
        detail: { code: error?.code || error?.message || 'AUTHORITY_PROJECTION_REFRESH_FAILED' },
      }));
    });
  }

  public async refreshAuthorityProjection({
    minSourceVersion = 0,
  }: { minSourceVersion?: number } = {}): Promise<void> {
    if (typeof window.desktopIdentitySessionProvider?.listCloudBusinessProjection === 'function') {
      const [payload, questions, outbox] = await Promise.all([
        window.desktopIdentitySessionProvider.listCloudBusinessProjection(),
        typeof window.desktopIdentitySessionProvider.listCloudQuestions === 'function'
          ? window.desktopIdentitySessionProvider.listCloudQuestions()
          : Promise.resolve([]),
        window.desktopAuthority?.list ? window.desktopAuthority.list() : Promise.resolve([]),
      ]);
      const cachedAt = new Date().toISOString();
      const cloudQuestions = questions.map(question => ({
        ...question,
        storage_state: 'cloud_cached',
        created_at: question.created_at || cachedAt,
        updated_at: question.updated_at || cachedAt,
      }));
      const next = buildAuthorityBackedBrowserCache({
        projection: {
          protocol: 'gewu.authority-projection.v1',
          authorityId: 'cloud-business',
          hostEpochId: 'cloud-business',
          userId: readCurrentDesktopIdentityContext()?.userId || '',
          role: readCurrentDesktopIdentityContext()?.activeRole || '',
          sourceVersion: Math.max(0, Number(minSourceVersion) || 0),
          payload: { ...payload, questions: cloudQuestions },
        },
        outbox,
        localOnly: {
          questionBasketIds: this.data.questionBasketIds,
          questionVersions: this.data.questionVersions,
          importTasks: this.data.importTasks,
          importTaskItems: this.data.importTaskItems,
        },
      });
      this.data = { ...emptyDatabase(), ...next } as Database;
      this.hydrateTaxonomiesFromSyncRows();
      this.migrateLegacyQuestionData();
      this.migrateLegacyTagData();
      this.migrateQuestionVersionData();
      this.migrateImportTaskData();
      this.rebuildQuestionIndexes();
      this.saveData();
      window.dispatchEvent(new CustomEvent('authority-projection-refreshed', {
        detail: { sourceVersion: Math.max(0, Number(minSourceVersion) || 0) },
      }));
      return;
    }
    if (!window.desktopAuthority?.readProjection || !window.desktopAuthority?.list) {
      throw Object.assign(new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE'), {
        code: 'DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE',
      });
    }
    const [projection, outbox] = await Promise.all([
      window.desktopAuthority.readProjection({ minSourceVersion }),
      window.desktopAuthority.list(),
    ]);
    const next = buildAuthorityBackedBrowserCache({
      projection,
      outbox,
      localOnly: {
        questionBasketIds: this.data.questionBasketIds,
        questionVersions: this.data.questionVersions,
        importTasks: this.data.importTasks,
        importTaskItems: this.data.importTaskItems,
      },
    });
    this.data = {
      ...emptyDatabase(),
      ...next,
    } as Database;
    this.hydrateTaxonomiesFromSyncRows();
    this.migrateLegacyQuestionData();
    this.migrateLegacyTagData();
    this.migrateQuestionVersionData();
    this.migrateImportTaskData();
    this.rebuildQuestionIndexes();
    this.saveData();
    window.dispatchEvent(new CustomEvent('authority-projection-refreshed', {
      detail: {
        sourceVersion: Number((projection as any).sourceVersion || 0),
      },
    }));
  }

  private loadData(): void {
    let stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      const legacy = localStorage.getItem('scheduling_system_db_v3');
      if (legacy) {
        try {
          const projected = projectDesktopCacheForIdentity(
            JSON.parse(legacy),
            readCurrentDesktopIdentityContext()
          );
          stored = JSON.stringify(projected);
          localStorage.setItem(this.storageKey, stored);
        } catch (error) {
          console.warn('[browserDatabase] legacy identity partition projection skipped:', error);
        }
      }
    }
    let loadedData: any = null;
    if (stored) {
      loadedData = JSON.parse(stored);
      // 合并数据，确保所有数组字段都存在，旧版本数据缺失就用 []
      this.data = {
        students: [],
        student_contacts: [],
        grades: [],
        courses: [],
        schedules: [],
        enrollments: [],
        payments: [],
        consumptions: [],
        institutions: [],
        schools: [],
        rooms: [],
        teachers: [],
        assetRecords: [],
        assetCategories: [
          {id:'builtin-tuition',name:'课时费',type:'income',color:'#3f8600',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-payment',name:'学费',type:'income',color:'#1890ff',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-salary',name:'工资支出',type:'expense',color:'#cf1322',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-rent',name:'房租',type:'expense',color:'#fa8c16',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-material',name:'教材费',type:'expense',color:'#722ed1',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-other-income',name:'其他收入',type:'income',color:'#13c2c2',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
          {id:'builtin-other-expense',name:'其他支出',type:'expense',color:'#eb2f96',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},
        ],
        questions: [],
        knowledgeTree: loadedData?.knowledgeTree ?? [],
        modelTree: loadedData?.modelTree ?? [],
        taxonomySystems: loadedData?.taxonomySystems ?? [],
        taxonomyInitialized: loadedData?.taxonomyInitialized === true,
        taxonomy_systems: loadedData?.taxonomy_systems ?? [],
        taxonomy_nodes: loadedData?.taxonomy_nodes ?? [],
        tags: loadedData?.tags ?? [],
        questionTagRels: loadedData?.questionTagRels ?? [],
        questionBasketIds: loadedData?.questionBasketIds ?? [],
        questionVersions: loadedData?.questionVersions ?? [],
        importTasks: loadedData?.importTasks ?? [],
        importTaskItems: loadedData?.importTaskItems ?? [],
        ...loadedData
      };
    }
    this.migrateLegacyQuestionData();
    this.migrateLegacyTagData();
    this.migrateQuestionVersionData();
    this.migrateImportTaskData();
    this.rebuildQuestionIndexes();
    // 自动清理：修复课程时间 > 24:00 的坏数据
    this.data.schedules = (this.data.schedules || []).map(s => {
      if (!s) return s;
      const fixTime = (t: string): string => {
        const [datePart, timePart] = t.split(' ');
        if (!timePart) return t;
        const [h, m] = timePart.split(':').map(Number);
        if (h >= 24) {
          return `${datePart} 23:${String(m).padStart(2, '0')}`;
        } else if (h < 0) {
          return `${datePart} 00:${String(m).padStart(2, '0')}`;
        }
        return t;
      };
      if (s.start_time) s.start_time = fixTime(s.start_time);
      if (s.end_time) s.end_time = fixTime(s.end_time);
      return s;
    });
    this.authorityCacheCheckpoint.commit(this.data);

    // 自动更新学生年级
    this.data.students = (this.data.students || []).map(s => ({
      ...s,
      grade_current: calculateGrade(s.grade_year)
    }));
    this.ensureInstitutionStudents(false);

    // 题型迁移：旧题型统一为5种
    const typeMigrateMap: Record<string, string> = {
      '选择题': '单选题',
      '填空题': '解答题',
      '简答题': '解答题',
      '作图题': '解答题',
    };
    this.data.questions = (this.data.questions || []).map(q => {
      if (!q) return q;
      const migrated = { ...q };
      if (typeMigrateMap[q.type]) {
        migrated.type = typeMigrateMap[q.type] as Question['type'];
      }
      if (!migrated.status) migrated.status = 'draft';
      if (migrated.has_image === undefined) migrated.has_image = /<img|!\[/.test(migrated.content || '');
      if (migrated.has_formula === undefined) migrated.has_formula = /\$\$|\\\[|\\\(/.test(migrated.content || '');
      if (migrated.created_by === undefined) migrated.created_by = '';
      return migrated;
    });

    // 知识树迁移到 tag 表
    this.data.taxonomySystems = this.data.taxonomySystems || [];
    this.data.taxonomyInitialized = this.data.taxonomyInitialized === true;
    this.data.tags = this.data.tags || [];
    if (this.data.tags.length === 0 && this.data.knowledgeTree.length > 0) {
      const now = new Date().toISOString();
      this.data.tags = this.data.knowledgeTree.map((n: KnowledgeNode) => ({
        id: n.id,
        tag_type: 'knowledge' as const,
        tag_name: n.name,
        tag_code: n.id,
        parent_id: n.parent_id || undefined,
        subject: '物理',
        sort_no: n.order,
        status: 1,
        created_at: n.created_at || now,
        updated_at: n.updated_at || now,
      }));
    }

    // 模型标签种子数据
    const MODEL_TAGS = [
      { id: 'model-process', tag_name: '过程模型', sort_no: 1 },
      { id: 'model-em-induction', tag_name: '电磁感应模型', sort_no: 2 },
      { id: 'model-em-field', tag_name: '电磁场模型', sort_no: 3 },
      { id: 'model-plate', tag_name: '板块模型', sort_no: 4 },
      { id: 'model-conveyor', tag_name: '传送带模型', sort_no: 5 },
      { id: 'model-image', tag_name: '图像模型', sort_no: 6 },
      { id: 'model-force', tag_name: '受力分析模型', sort_no: 7 },
    ];
    const now2 = new Date().toISOString();
    for (const mt of (this.data.taxonomySystems.some(system => system.id === 'model') ? MODEL_TAGS : [])) {
      if (!this.data.tags.find((t: Tag) => t.id === mt.id)) {
        this.data.tags.push({
          id: mt.id,
          tag_type: 'model',
          tag_name: mt.tag_name,
          tag_code: mt.id,
          parent_id: undefined,
          subject: '物理',
          sort_no: mt.sort_no,
          status: 1,
          created_at: now2,
          updated_at: now2,
        });
      }
    }
    this.syncTaxonomySyncRowsFromCanonical();

    // 课程颜色自动分配（首次启动：扫描所有课程，根据上课地址分配背景色）
    const coursesNeedColor = this.data.courses.some((c: any) => !c.color);
    if (coursesNeedColor && this.data.courses.length > 0) {
      let changed = false;
      for (const c of this.data.courses) {
        if (!c.color) {
          c.color = getColorForRoom(c.room_id || c.room_name, this.data.rooms);
          changed = true;
        }
      }
      if (changed) this.saveData();
    }
  }

  private saveData(): void {
    this.rebuildQuestionIndexes();
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch (error) {
      this.compactLargeQuestionPayloads();
      localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    }
    this.authorityCacheCheckpoint.commit(this.data);
  }

  private restoreAuthorityCacheCheckpoint(restored: Database): void {
    this.data = restored;
    this.rebuildQuestionIndexes();
  }

  private getSyncDeviceId(): string {
    try {
      const key = this.identityStorageKey('sync_engine_sync_device_id');
      const existing = migrateLegacyStorageValue(
        localStorage,
        'sync_engine_sync_device_id',
        { allowRoles: 'all' as any }
      );
      if (existing) return JSON.parse(existing);
      const id = `desktop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(key, JSON.stringify(id));
      localStorage.setItem(this.identityStorageKey('sync_engine_sync_client_id'), JSON.stringify(id));
      return id;
    } catch {
      return 'desktop';
    }
  }

  private getAuthorizationUserId(): string {
    try {
      const session = readDesktopAuthorizationSession();
      return session.authContext.userId;
    } catch {
      try { return readCurrentDesktopIdentityContext().userId; } catch { return ''; }
    }
  }

  private recordAuthorityDraft(
    collection: SyncTable,
    action: SyncAction,
    recordId: string,
    value: Record<string, any> = {},
    baseVersion: string | null = null,
  ): void {
    const draft = createAuthorityDraftFromLocalMutation({
      collection,
      action,
      recordId,
      value,
      baseVersion,
    });
    this.authorityCacheCheckpoint.guard(() => {
      if (!window.desktopAuthority?.appendDraftSync) {
        throw Object.assign(new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE'), {
          code: 'DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE',
        });
      }
      window.desktopAuthority.appendDraftSync(draft);
    }, (restored: Database) => this.restoreAuthorityCacheCheckpoint(restored));
  }

  private recordAuthorityDraftBatch(changes: Array<{
    collection: SyncTable;
    action: SyncAction;
    recordId: string;
    value?: Record<string, any>;
    baseVersion?: string | null;
  }>): void {
    if (changes.length === 0) return;
    const drafts = changes.map(change => createAuthorityDraftFromLocalMutation({
      collection: change.collection,
      action: change.action,
      recordId: change.recordId,
      value: change.value || {},
      baseVersion: change.baseVersion || null,
    }));
    this.authorityCacheCheckpoint.guard(() => {
      if (!window.desktopAuthority?.appendDraftBatchSync) {
        throw Object.assign(new Error('DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE'), {
          code: 'DESKTOP_AUTHORITY_BRIDGE_UNAVAILABLE',
        });
      }
      window.desktopAuthority.appendDraftBatchSync(drafts);
    }, (restored: Database) => this.restoreAuthorityCacheCheckpoint(restored));
  }

  private compactLargeQuestionPayloads(): void {
    const stripLargeValue = (value: any): any => {
      if (typeof value === 'string') {
        return value.length > 2000 ? value.replace(/data:[^"'\s>]+/g, '') : value;
      }
      if (Array.isArray(value)) return value.map(stripLargeValue);
      if (value && typeof value === 'object') {
        const next: any = { ...value };
        if (typeof next.data_url === 'string' && next.data_url.startsWith('data:')) next.data_url = '';
        if (typeof next.url === 'string' && next.url.startsWith('data:')) next.url = '';
        if (typeof next.oss_url === 'string' && next.oss_url.startsWith('data:')) next.oss_url = '';
        Object.keys(next).forEach(key => { next[key] = stripLargeValue(next[key]); });
        return next;
      }
      return value;
    };
    this.data.questions = (this.data.questions || []).map(question => stripLargeValue(question));
    this.data.importTaskItems = (this.data.importTaskItems || []).map(item => ({
      ...item,
      payload: item.payload ? stripLargeValue(item.payload) : item.payload,
    }));
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private questionIndexText(question: Partial<Question>): string {
    return buildBrowserQuestionSearchText(question);
  }

  private rebuildQuestionIndexes(): void {
    const next = new Map<string, string>();
    for (const question of this.data.questions || []) {
      if (question?.id) next.set(question.id, this.questionIndexText(question));
    }
    this.questionSearchIndex = next;
  }

  private businessDataSnapshot(): Partial<Database> {
    return {
      students: this.data.students || [],
      grades: this.data.grades || [],
      courses: this.data.courses || [],
      schedules: this.data.schedules || [],
      enrollments: this.data.enrollments || [],
      payments: this.data.payments || [],
      consumptions: this.data.consumptions || [],
      institutions: this.data.institutions || [],
      schools: this.data.schools || [],
      rooms: this.data.rooms || [],
      teachers: this.data.teachers || [],
      assetRecords: this.data.assetRecords || [],
      assetCategories: this.data.assetCategories || [],
    };
  }

  private createBusinessDataSafetyBackup(reason: string): void {
    try {
      const backupKey = this.identityStorageKey(BUSINESS_DATA_SAFETY_BACKUP_KEY);
      const existingRaw = migrateLegacyStorageValue(
        localStorage,
        BUSINESS_DATA_SAFETY_BACKUP_KEY,
        { allowRoles: ['super_admin', 'admin'] }
      );
      const existing = JSON.parse(existingRaw || '[]');
      const backups = Array.isArray(existing) ? existing : [];
      const next = [{
        id: `business_backup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        reason,
        created_at: new Date().toISOString(),
        data: this.businessDataSnapshot(),
      }, ...backups].slice(0, BUSINESS_DATA_SAFETY_BACKUP_LIMIT);
      localStorage.setItem(backupKey, JSON.stringify(next));
    } catch (error) {
      console.warn('[browserDatabase] create business data safety backup failed:', error);
    }
  }

  private syncQuestionLocalRecord(question: Question): void {
    upsertQuestionLocalRecord(question).catch(() => undefined);
  }

  private removeQuestionLocalIndex(id: string): void {
    removeQuestionLocalRecord(id).catch(() => undefined);
  }

  private syncTreeCache(): void {
    cacheQuestionTrees(this.getKnowledgeTree(), this.getModelTree()).catch(() => undefined);
  }

  private detectQuestionHasFormula(question: Partial<Question>): boolean {
    if (question.has_formula !== undefined) return !!question.has_formula;
    const parts = [
      question.content,
      question.answer,
      question.analysis,
      ...(Array.isArray(question.options) ? question.options : []),
      ...(Array.isArray(question.formulas) ? question.formulas : []),
    ].map(value => String(value || ''));
    return parts.some(text => /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|<math\b|data-formula|formula/i.test(text));
  }

  private detectQuestionHasImage(question: Partial<Question>): boolean {
    if (question.has_image !== undefined) return !!question.has_image;
    const assets = Array.isArray((question as any).assets) ? (question as any).assets : [];
    if (assets.length > 0) return true;
    const parts = [
      question.content,
      question.answer,
      question.analysis,
      ...(Array.isArray(question.options) ? question.options : []),
    ].map(value => String(value || ''));
    return parts.some(text => /<img\b|!\[[^\]]*\]\([^)]+\)|\.(png|jpe?g|gif|webp|svg)(\?|#|\s|$)/i.test(text));
  }

  private normalizeQuestionRecord(question: Question): Question {
    const richNormalized = normalizeBrowserQuestionRecord(question as any);
    const normalized: Question = {
      ...richNormalized,
      subject: question.subject || '物理',
      type: normalizeQuestionType(question.type),
      exam_type: question.exam_type || '其他',
      edit_status: question.edit_status || '未编辑',
      status: question.status || 'draft',
      has_image: richNormalized.has_image || this.detectQuestionHasImage(question),
      has_formula: richNormalized.has_formula || this.detectQuestionHasFormula(question),
      created_by: question.created_by || '',
      storage_state: question.storage_state || 'local_draft',
      knowledge_ids: question.knowledge_ids || question.knowledge_point_ids || [],
      model_ids: question.model_ids || question.model_point_ids || [],
    };
    return normalized;
  }

  private normalizeImportTask(task: Partial<ImportTask>): ImportTask {
    const now = new Date().toISOString();
    return {
      id: task.id || this.generateId(),
      source_type: task.source_type || 'manual',
      file_name: task.file_name || '',
      file_hash: task.file_hash || '',
      status: (task.status || 'pending') as ImportTaskStatus,
      total_items: Number(task.total_items || 0),
      success_items: Number(task.success_items || 0),
      warning_items: Number(task.warning_items || 0),
      failed_items: Number(task.failed_items || 0),
      duplicate_items: Number(task.duplicate_items || 0),
      quality_report: task.quality_report || null,
      result_summary: task.result_summary || null,
      created_at: task.created_at || now,
      updated_at: task.updated_at || task.created_at || now,
    };
  }

  private normalizeImportTaskItem(item: Partial<ImportTaskItem>): ImportTaskItem {
    const now = new Date().toISOString();
    const rawWarnings = (item as any).warnings;
    const rawErrors = (item as any).errors;
    const warnings: string[] = Array.isArray(rawWarnings)
      ? rawWarnings
      : typeof rawWarnings === 'string' && rawWarnings
        ? rawWarnings.split(',').map((value: string) => value.trim()).filter(Boolean)
        : [];
    const errors: string[] = Array.isArray(rawErrors)
      ? rawErrors
      : typeof rawErrors === 'string' && rawErrors
        ? rawErrors.split(',').map((value: string) => value.trim()).filter(Boolean)
        : [];
    return {
      id: item.id || this.generateId(),
      task_id: item.task_id || '',
      item_index: Number(item.item_index || 0),
      question_id: item.question_id || '',
      content_hash: item.content_hash || '',
      status: (item.status || 'pending') as ImportTaskItemStatus,
      quality_score: Number(item.quality_score || 0),
      warnings,
      errors,
      error_message: item.error_message || '',
      payload: item.payload || null,
      created_at: item.created_at || now,
      updated_at: item.updated_at || item.created_at || now,
    };
  }

  private migrateLegacyQuestionData(): void {
    this.data.questions = (this.data.questions || []).map(question => this.normalizeQuestionRecord(question));
  }

  private normalizeQuestionVersion(version: Partial<QuestionVersion>, fallbackIndex = 0): QuestionVersion | null {
    if (!version.question_id || !version.snapshot) return null;
    const now = new Date().toISOString();
    return {
      id: version.id || this.generateId(),
      question_id: version.question_id,
      version_no: Number(version.version_no || fallbackIndex + 1),
      snapshot: this.normalizeQuestionRecord(version.snapshot as Question),
      created_at: version.created_at || now,
      created_by: version.created_by || '',
      note: version.note || '',
    };
  }

  private migrateQuestionVersionData(): void {
    const grouped = new Map<string, QuestionVersion[]>();
    (this.data.questionVersions || []).forEach((item, index) => {
      const normalized = this.normalizeQuestionVersion(item, index);
      if (!normalized) return;
      const list = grouped.get(normalized.question_id) || [];
      list.push(normalized);
      grouped.set(normalized.question_id, list);
    });
    this.data.questionVersions = [];
    grouped.forEach(list => {
      list
        .sort((a, b) => a.version_no - b.version_no || a.created_at.localeCompare(b.created_at))
        .slice(-QUESTION_VERSION_LIMIT)
        .forEach((item, index) => {
          this.data.questionVersions.push({ ...item, version_no: index + 1 });
        });
    });
  }

  private migrateImportTaskData(): void {
    this.data.importTasks = (this.data.importTasks || []).map(task => this.normalizeImportTask(task));
    this.data.importTaskItems = (this.data.importTaskItems || [])
      .map(item => this.normalizeImportTaskItem(item))
      .filter(item => Boolean(item.task_id));
  }

  private migrateLegacyTagData(): void {
    this.data.tags = upsertLegacyTreeTags(this.data.tags || [], this.data.knowledgeTree || [], 'knowledge', '\u7269\u7406');
    this.data.tags = upsertLegacyTreeTags(this.data.tags || [], this.data.modelTree || [], 'model', '\u7269\u7406');

    const migratedRels = [
      ...(this.data.questionTagRels || []),
      ...(this.data.questions || []).flatMap(question => [
        ...relsFromQuestionLegacyIds(question, 'knowledge'),
        ...relsFromQuestionLegacyIds(question, 'model'),
      ]),
    ];
    this.data.questionTagRels = normalizeQuestionTagRels(migratedRels);
    this.migrateTaxonomySystems();
    this.syncLegacyTreesFromTags();
    this.syncAllQuestionLegacyTagFields();
  }

  private migrateTaxonomySystems(): void {
    const now = new Date().toISOString();
    const systems = [...(this.data.taxonomySystems || [])];
    const ensure = (id: string, name: string, sortNo: number) => {
      if (systems.some(system => system.id === id)) return;
      systems.push({ id, name, subject: '\u7269\u7406', sort_no: sortNo, created_at: now, updated_at: now });
    };
    if (!this.data.taxonomyInitialized) {
      ensure('knowledge', '\u77e5\u8bc6\u70b9', 1);
      ensure('model', '\u6a21\u578b', 2);
    }
    this.data.taxonomySystems = systems;
    this.data.taxonomyInitialized = true;
    for (const question of this.data.questions || []) {
      question.taxonomy_ids = {
        ...(question.taxonomy_ids || {}),
        knowledge: [...new Set(question.knowledge_ids || question.knowledge_point_ids || [])],
        model: [...new Set(question.model_ids || question.model_point_ids || [])],
      };
    }
  }

  private syncTaxonomySyncRowsFromCanonical(): void {
    const activeSystemIds = new Set((this.data.taxonomySystems || []).map(system => system.id));
    this.data.taxonomy_systems = (this.data.taxonomySystems || []).map(system => ({
      id: system.id,
      subject: system.subject,
      name: system.name,
      sort_order: system.sort_no,
      deleted: 0,
      created_at: system.created_at,
      updated_at: system.updated_at,
    }));
    this.data.taxonomy_nodes = (this.data.tags || [])
      .filter(tag => activeSystemIds.has(tag.tag_type) && tag.status !== 0)
      .map(tag => ({
        id: tag.id,
        system_id: tag.tag_type,
        parent_id: tag.parent_id || null,
        name: tag.tag_name,
        sort_order: tag.sort_no,
        deleted: 0,
        created_at: tag.created_at,
        updated_at: tag.updated_at,
      }));
  }

  private hydrateTaxonomiesFromSyncRows(): void {
    const systems = (this.data.taxonomy_systems || []).filter(row => !row.deleted).map(row => ({
      id: String(row.id),
      subject: String(row.subject || ''),
      name: String(row.name || ''),
      sort_no: Number(row.sort_order || 0),
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || row.created_at || new Date().toISOString(),
    }));
    if (systems.length === 0 && (this.data.taxonomy_systems || []).length === 0) return;
    const systemIds = new Set(systems.map(system => system.id));
    const knownSystemIds = new Set((this.data.taxonomy_systems || []).map(row => String(row.id)));
    this.data.taxonomySystems = systems;
    this.data.tags = [
      ...(this.data.tags || []).filter(tag => !knownSystemIds.has(tag.tag_type)),
      ...(this.data.taxonomy_nodes || []).filter(row => !row.deleted && systemIds.has(String(row.system_id))).map(row => ({
        id: String(row.id),
        tag_type: String(row.system_id),
        tag_name: String(row.name || ''),
        tag_code: String(row.id),
        parent_id: row.parent_id || undefined,
        subject: systems.find(system => system.id === String(row.system_id))?.subject,
        sort_no: Number(row.sort_order || 0),
        status: 1,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || row.created_at || new Date().toISOString(),
      })),
    ];
    this.syncLegacyTreesFromTags();
    this.syncAllQuestionLegacyTagFields();
  }

  private syncLegacyTreesFromTags(): void {
    this.data.knowledgeTree = tagsToLegacyTree(this.data.tags || [], 'knowledge', this.data.knowledgeTree || []);
    this.data.modelTree = tagsToLegacyTree(this.data.tags || [], 'model', this.data.modelTree || []);
  }

  private syncAllQuestionLegacyTagFields(): void {
    for (const question of this.data.questions || []) {
      this.syncQuestionLegacyTagFields(question.id);
    }
  }

  private syncQuestionLegacyTagFields(questionId: string): void {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return;
    const rels = this.getQuestionTagRels(questionId);
    const knowledgeIds = rels.filter(rel => rel.tag_type === 'knowledge').map(rel => rel.tag_id);
    const modelIds = rels.filter(rel => rel.tag_type === 'model').map(rel => rel.tag_id);
    question.knowledge_ids = [...new Set(knowledgeIds)];
    question.model_ids = [...new Set(modelIds)];
    question.taxonomy_ids = {
      ...(question.taxonomy_ids || {}),
      ...Object.fromEntries(this.getTaxonomySystems(question.subject || '\u7269\u7406').map(system => [
        system.id,
        [...new Set(rels.filter(rel => rel.tag_type === system.id).map(rel => rel.tag_id))],
      ])),
    };
    const primaryKnowledge = question.knowledge_ids.length > 0
      ? this.data.tags.find(tag => tag.id === question.knowledge_ids![0] && tag.tag_type === 'knowledge')
      : null;
    const primaryModel = question.model_ids.length > 0
      ? this.data.tags.find(tag => tag.id === question.model_ids![0] && tag.tag_type === 'model')
      : null;
    question.knowledge_point = primaryKnowledge?.tag_name || '';
    question.model_point = primaryModel?.tag_name || '';
  }

  private replaceQuestionTagRels(questionId: string, tagType: TagType, tagIds: string[]): void {
    const tagsOfType = (this.data.tags || []).filter(tag => tag.tag_type === tagType && tag.status !== 0);
    const validIds = new Set(tagsOfType.map(tag => tag.id));
    const inputIds = [...new Set(tagIds || [])].filter(Boolean);
    const nextIds = inputIds.filter(id => validIds.size === 0 || validIds.has(id));
    const now = new Date().toISOString();
    this.data.questionTagRels = normalizeQuestionTagRels([
      ...(this.data.questionTagRels || []).filter(rel => !(rel.question_id === questionId && rel.tag_type === tagType)),
      ...nextIds.map(tagId => ({
        id: makeQuestionTagRelId(questionId, tagId, tagType),
        question_id: questionId,
        tag_id: tagId,
        tag_type: tagType,
        created_at: now,
      })),
    ]);
    this.syncQuestionLegacyTagFields(questionId);
  }

  private syncQuestionRelsFromLegacyFields(question: Question): void {
    this.replaceQuestionTagRels(question.id, 'knowledge', [
      ...(question.knowledge_ids || []),
      ...(question.knowledge_point_ids || []),
    ]);
    this.replaceQuestionTagRels(question.id, 'model', [
      ...(question.model_ids || []),
      ...(question.model_point_ids || []),
    ]);
    for (const [systemId, nodeIds] of Object.entries(question.taxonomy_ids || {})) {
      if (systemId === 'knowledge' || systemId === 'model') continue;
      this.replaceQuestionTagRels(question.id, systemId, nodeIds || []);
    }
  }

  // ========== 学校信息管理 ==========
  
  getAllSchools(): SchoolInfo[] {
    return this.data.schools;
  }

  // ========== 教室/地址管理 ==========
  
  getAllRooms(): Room[] {
    return this.data.rooms;
  }

  addOrUpdateRoom(roomName: string, address?: string): void {
    const existing = this.data.rooms.find(s => s.name === roomName);
    if (existing) {
      const baseVersion = existing.updated_at || null;
      existing.count++;
      existing.updated_at = new Date().toISOString();
      if (address) existing.address = address;
      this.recordAuthorityDraft('rooms', 'update', existing.id, existing, baseVersion);
    } else {
      const room = {
        id: this.generateId(),
        name: roomName,
        address: address || '',
        count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.data.rooms.push(room);
      this.recordAuthorityDraft('rooms', 'create', room.id, room);
    }
    this.saveData();
  }

  updateRoom(id: string, updates: Partial<Room>): Room | undefined {
    const index = this.data.rooms.findIndex(r => r.id === id);
    if (index === -1) return undefined;
    const baseVersion = this.data.rooms[index].updated_at || null;
    this.data.rooms[index] = { ...this.data.rooms[index], ...updates, updated_at: new Date().toISOString() };
    this.recordAuthorityDraft('rooms', 'update', id, this.data.rooms[index], baseVersion);
    this.saveData();
    return this.data.rooms[index];
  }

  deleteRoom(id: string): boolean {
    const index = this.data.rooms.findIndex(r => r.id === id);
    if (index === -1) return false;
    const baseVersion = this.data.rooms[index].updated_at || null;
    this.data.rooms.splice(index, 1);
    this.recordAuthorityDraft('rooms', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  // ========== 学校信息管理 ==========

  getSchoolNames(): string[] {
    return this.data.schools.map(s => s.name).sort();
  }

  addOrUpdateSchool(schoolName: string): void {
    const existing = this.data.schools.find(s => s.name === schoolName);
    if (existing) {
      const baseVersion = existing.updated_at || null;
      existing.count++;
      existing.updated_at = new Date().toISOString();
      this.recordAuthorityDraft('schools', 'update', existing.id, existing, baseVersion);
    } else {
      const school = {
        id: this.generateId(),
        name: schoolName,
        count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this.data.schools.push(school);
      this.recordAuthorityDraft('schools', 'create', school.id, school);
    }
    this.saveData();
  }

  updateSchool(id: string, updates: Partial<SchoolInfo>): SchoolInfo | undefined {
    const index = this.data.schools.findIndex(s => s.id === id);
    if (index === -1) return undefined;
    const baseVersion = this.data.schools[index].updated_at || null;
    this.data.schools[index] = { ...this.data.schools[index], ...updates, updated_at: new Date().toISOString() };
    this.recordAuthorityDraft('schools', 'update', id, this.data.schools[index], baseVersion);
    this.saveData();
    return this.data.schools[index];
  }

  deleteSchool(id: string): boolean {
    const index = this.data.schools.findIndex(s => s.id === id);
    if (index === -1) return false;
    const baseVersion = this.data.schools[index].updated_at || null;
    this.data.schools.splice(index, 1);
    this.recordAuthorityDraft('schools', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  // ========== 机构管理 ==========
  
  getAllInstitutions(): Institution[] {
    return this.data.institutions;
  }

  createInstitution(institution: Omit<Institution, 'id' | 'created_at' | 'updated_at'>): Institution {
    const now = new Date().toISOString();
    const newInstitution: Institution = {
      ...institution,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    this.data.institutions.push(newInstitution);
    this.recordAuthorityDraft('institutions', 'create', newInstitution.id, newInstitution);
    this.ensureInstitutionStudents(true);
    this.saveData();
    return newInstitution;
  }

  updateInstitution(id: string, updates: Partial<Institution>): Institution | undefined {
    const index = this.data.institutions.findIndex(i => i.id === id);
    if (index === -1) return undefined;
    const baseVersion = this.data.institutions[index].updated_at || null;
    this.data.institutions[index] = { ...this.data.institutions[index], ...updates, updated_at: new Date().toISOString() };
    this.recordAuthorityDraft('institutions', 'update', id, this.data.institutions[index], baseVersion);
    this.ensureInstitutionStudents(true);
    this.saveData();
    return this.data.institutions[index];
  }

  private ensureInstitutionStudents(captureDrafts = false): void {
    const now = new Date().toISOString();
    for (const institution of this.data.institutions || []) {
      const existing = (this.data.students || []).find(student => student.is_institution_student && student.institution_id === institution.id);
      const name = String(institution.name || '').trim() + '\u5b66\u751f';
      if (existing) {
        if (existing.name === name && existing.source_type === StudentSource.INSTITUTION) continue;
        const baseVersion = existing.updated_at || null;
        existing.name = name; existing.source_type = StudentSource.INSTITUTION; existing.updated_at = now;
        if (captureDrafts) this.recordAuthorityDraft('students', 'update', existing.id, { ...existing, contacts: this.studentAuthorityContacts(existing) }, baseVersion);
      } else {
        const created = { id: this.generateId(), name, source_type: StudentSource.INSTITUTION, institution_id: institution.id,
          is_institution_student: true, balance_hours: 0, balance_money: 0, notes: '\u673a\u6784\u8bfe\u7a0b\u8d39\u7528\u4e13\u7528\u5b66\u751f', created_at: now, updated_at: now } as Student;
        this.data.students.push(created);
        if (captureDrafts) this.recordAuthorityDraft('students', 'create', created.id, { ...created, contacts: this.studentAuthorityContacts(created) });
      }
    }
  }

  deleteInstitution(id: string): boolean {
    const index = this.data.institutions.findIndex(i => i.id === id);
    if (index === -1) return false;
    const baseVersion = this.data.institutions[index].updated_at || null;
    this.data.institutions.splice(index, 1);
    this.recordAuthorityDraft('institutions', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  // ========== 学生管理 ==========
  
  getAllStudents(): Student[] {
    return this.data.students;
  }

  getAllStudentContacts(): any[] {
    return this.data.student_contacts || [];
  }

  private studentAuthorityContacts(student: Student): Array<Record<string, any>> {
    const bySlot = new Map(
      (this.data.student_contacts || [])
        .filter(contact => contact.student_id === student.id)
        .map(contact => [Number(contact.slot), contact]),
    );
    const primary = bySlot.get(1);
    const guardian = bySlot.get(2);
    const owns = (key: string) => Object.prototype.hasOwnProperty.call(student, key);
    const normalized = (value: any) => typeof value === 'string' && value.trim() ? value.trim() : null;
    const primaryPhone = owns('phone') ? normalized(student.phone) : primary?.phone ?? null;
    const primaryWechat = owns('student_wechat') ? normalized(student.student_wechat) : primary?.wechat ?? null;
    const guardianPhone = owns('parent_phone') ? normalized(student.parent_phone) : guardian?.phone ?? null;
    const guardianWechat = owns('parent_wechat') ? normalized(student.parent_wechat) : guardian?.wechat ?? null;
    const guardianTwo = bySlot.get(3);
    const guardianTwoPhone = owns('second_parent_phone') ? normalized(student.second_parent_phone) : guardianTwo?.phone ?? null;
    const guardianTwoWechat = owns('second_parent_wechat') ? normalized(student.second_parent_wechat) : guardianTwo?.wechat ?? null;
    return [
      ...(primaryPhone || primaryWechat || primary ? [{
        slot: 1,
        relationship: 'student',
        phone: primaryPhone,
        wechat: primaryWechat,
        updated_at: primary?.updated_at ?? null,
      }] : []),
      ...(guardianPhone || guardianWechat || guardian ? [{
        slot: 2,
        relationship: 'guardian',
        phone: guardianPhone,
        wechat: guardianWechat,
        updated_at: guardian?.updated_at ?? null,
      }] : []),
      ...(guardianTwoPhone || guardianTwoWechat || guardianTwo ? [{
        slot: 3,
        relationship: 'guardian',
        phone: guardianTwoPhone,
        wechat: guardianTwoWechat,
        updated_at: guardianTwo?.updated_at ?? null,
      }] : []),
    ];
  }

  getStudentById(id: string): Student | undefined {
    return this.data.students.find(s => s.id === id);
  }

  createStudent(student: Omit<Student, 'id' | 'created_at' | 'updated_at'>): Student {
    const now = new Date().toISOString();
    const newStudent: Student = {
      ...student,
      id: this.generateId(),
      grade_current: calculateGrade(student.grade_year),
      created_at: now,
      updated_at: now
    };
    
    // 如果提供了学校，添加到学校库
    if (student.school) {
      this.addOrUpdateSchool(student.school);
    }
    
    this.data.students.push(newStudent);
    this.recordAuthorityDraft('students', 'create', newStudent.id, { ...newStudent, contacts: this.studentAuthorityContacts(newStudent) });
    this.saveData();
    return newStudent;
  }

  updateStudent(id: string, updates: Partial<Student>): Student | undefined {
    const index = this.data.students.findIndex(s => s.id === id);
    if (index === -1) return undefined;
    const baseVersion = this.data.students[index].updated_at || null;
    
    const updated = {
      ...this.data.students[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    
    // 如果更新了入学年份，重新计算年级
    if (updates.grade_year) {
      updated.grade_current = calculateGrade(updates.grade_year);
    }
    
    // 如果提供了新学校，添加到学校库
    if (updates.school && updates.school !== this.data.students[index].school) {
      this.addOrUpdateSchool(updates.school);
    }
    
    this.data.students[index] = updated;
    const draftValue = {
      ...updated,
      contacts: this.studentAuthorityContacts(updated),
    };
    this.recordAuthorityDraft('students', 'update', id, draftValue, baseVersion);
    this.saveData();
    return updated;
  }

  deleteStudent(id: string): boolean {
    const index = this.data.students.findIndex(s => s.id === id);
    if (index === -1) return false;
    const baseVersion = this.data.students[index].updated_at || null;
    this.data.students.splice(index, 1);
    this.recordAuthorityDraft('students', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  // ========== 课程管理 ==========
  
  getAllCourses(): Course[] {
    return this.data.courses;
  }

  getCourseById(id: string): Course | undefined {
    return this.data.courses.find(c => c.id === id);
  }

  createCourse(course: Omit<Course, 'id' | 'created_at' | 'updated_at'>): Course {
    const now = new Date().toISOString();
    const newCourse: Course = {
      ...course,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    // 如果提供了新教室名称，自动添加到教室库
    if (newCourse.room_name && !this.data.rooms.find(r => r.name === newCourse.room_name)) {
      this.addOrUpdateRoom(newCourse.room_name);
    }
    this.data.courses.push(newCourse);
    this.recordAuthorityDraft('courses', 'create', newCourse.id, newCourse);
    this.saveData();
    return newCourse;
  }

  updateCourse(id: string, updates: Partial<Course>): Course | undefined {
    const index = this.data.courses.findIndex(c => c.id === id);
    if (index === -1) return undefined;
    const baseVersion = this.data.courses[index].updated_at || null;
    
    this.data.courses[index] = {
      ...this.data.courses[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    // 如果更新了新教室名称，自动添加到教室库
    if (updates.room_name && !this.data.rooms.find(r => r.name === updates.room_name)) {
      this.addOrUpdateRoom(updates.room_name);
    }
    this.recordAuthorityDraft('courses', 'update', id, this.data.courses[index], baseVersion);
    this.saveData();
    return this.data.courses[index];
  }

  deleteCourse(id: string): boolean {
    const index = this.data.courses.findIndex(c => c.id === id);
    if (index === -1) return false;
    const baseVersion = this.data.courses[index].updated_at || null;
    this.data.courses.splice(index, 1);
    this.recordAuthorityDraft('courses', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  // ========== 排课管理 ==========
  
  getAllSchedules(): Schedule[] {
    return this.data.schedules;
  }

  getScheduleById(id: string): Schedule | undefined {
    return this.data.schedules.find(s => s.id === id);
  }

  createSchedule(schedule: Omit<Schedule, 'id' | 'created_at' | 'updated_at'>): Schedule {
    const now = new Date().toISOString();
    const newSchedule: Schedule = {
      ...schedule,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    this.data.schedules.push(newSchedule);
    this.recordAuthorityDraft('schedules', 'create', newSchedule.id, newSchedule);
    this.saveData();
    return newSchedule;
  }

  updateSchedule(id: string, updates: Partial<Schedule>): Schedule | undefined {
    const index = this.data.schedules.findIndex(s => s.id === id);
    if (index === -1) return undefined;
    const baseVersion = this.data.schedules[index].updated_at || null;
    
    this.data.schedules[index] = {
      ...this.data.schedules[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    this.recordAuthorityDraft('schedules', 'update', id, this.data.schedules[index], baseVersion);
    this.saveData();
    return this.data.schedules[index];
  }

  upsertSchedule(schedule: Partial<Schedule> & { id: string }): Schedule {
    const now = new Date().toISOString();
    const index = this.data.schedules.findIndex(s => s.id === schedule.id);
    if (index === -1) {
      const newSchedule = {
        ...schedule,
        created_at: schedule.created_at || now,
        updated_at: schedule.updated_at || now
      } as Schedule;
      this.data.schedules.push(newSchedule);
      this.recordAuthorityDraft('schedules', 'create', newSchedule.id, newSchedule);
      this.saveData();
      return newSchedule;
    }

    const updated = {
      ...this.data.schedules[index],
      ...schedule,
      updated_at: schedule.updated_at || now
    } as Schedule;
    const baseVersion = this.data.schedules[index].updated_at || null;
    this.data.schedules[index] = updated;
    this.recordAuthorityDraft('schedules', 'update', updated.id, updated, baseVersion);
    this.saveData();
    return updated;
  }

  replaceSchedules(schedules: Array<Partial<Schedule> & { id: string }>): Schedule[] {
    const now = new Date().toISOString();
    const previousById = new Map(this.data.schedules.map(s => [s.id, s]));
    const nextSchedules = (schedules || [])
      .filter(s => s?.id)
      .map(s => ({
        ...s,
        created_at: s.created_at || previousById.get(s.id)?.created_at || now,
        updated_at: s.updated_at || previousById.get(s.id)?.updated_at || now
      } as Schedule));

    const nextById = new Map(nextSchedules.map(s => [s.id, s]));
    const changes: Array<{ action: SyncAction; id: string; payload: Record<string, any>; baseVersion?: string | null }> = [];

    previousById.forEach((previous, id) => {
      if (!nextById.has(id)) {
        changes.push({ action: 'delete', id, payload: { id }, baseVersion: previous.updated_at || null });
      }
    });

    nextById.forEach((next, id) => {
      const previous = previousById.get(id);
      if (!previous) {
        changes.push({ action: 'create', id, payload: next });
      } else if (JSON.stringify(previous) !== JSON.stringify(next)) {
        const updated = { ...next, updated_at: now };
        nextById.set(id, updated);
        changes.push({ action: 'update', id, payload: updated, baseVersion: previous.updated_at || null });
      }
    });

    if (changes.length === 0) return this.data.schedules;

    this.createBusinessDataSafetyBackup('before-replaceSchedules');
    this.data.schedules = Array.from(nextById.values());
    this.recordAuthorityDraftBatch(changes.map(change => ({
      collection: 'schedules',
      action: change.action,
      recordId: change.id,
      value: change.payload,
      baseVersion: change.baseVersion || null,
    })));
    this.saveData();
    return this.data.schedules;
  }

  deleteSchedule(id: string): boolean {
    const index = this.data.schedules.findIndex(s => s.id === id);
    if (index === -1) return false;
    const baseVersion = this.data.schedules[index].updated_at || null;
    this.createBusinessDataSafetyBackup('before-deleteSchedule');
    this.data.schedules.splice(index, 1);
    this.recordAuthorityDraft('schedules', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  checkTimeConflict(startTime: string, endTime: string, excludeScheduleId?: string): Schedule[] {
    return this.data.schedules.filter(s => {
      if (s.status === ScheduleStatus.CANCELLED || s.status === ScheduleStatus.LEAVE) return false;
      if (s.id === excludeScheduleId) return false;
      return !(s.end_time <= startTime || s.start_time >= endTime);
    });
  }

  // ========== 统计数据 ==========
  
  getRevenueStats(startDate: string, endDate: string): RevenueStats {
    const schedules = this.data.schedules.filter(s => 
      s.status !== ScheduleStatus.CANCELLED &&
      s.status !== ScheduleStatus.LEAVE &&
      s.start_time >= startDate && s.start_time <= endDate
    );

    let total = 0;
    const byCourseType = new Map();
    const bySourceType = new Map();
    const byServiceType = new Map(); // 保留 map 不影响，只是不统计数据
    const byInstitution = new Map();
    const byMonth = new Map();

    schedules.forEach(schedule => {
      const tuition = schedule.calculated_tuition || 0;
      total += tuition;

      const course = this.data.courses.find(c => c.id === schedule.course_id);
      if (course) {
        byCourseType.set(course.type, (byCourseType.get(course.type) || 0) + tuition);
        bySourceType.set(course.source_type, (bySourceType.get(course.source_type) || 0) + tuition);
        // 删除服务类型统计，需求要求删除服务类型
        if (course.institution_id) {
          byInstitution.set(course.institution_id, (byInstitution.get(course.institution_id) || 0) + tuition);
        }
      }

      const month = schedule.start_time.substring(0, 7);
      byMonth.set(month, (byMonth.get(month) || 0) + tuition);
    });

    const courseTypeNames = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };
    const sourceTypeNames = { 1: '自有课程', 2: '机构排课', 3: '混合班' };
    const serviceTypeNames = { 1: '中心内', 2: '上门' };

    return {
      total,
      totalSchedules: schedules.length,
      byCourseType: Array.from(byCourseType.entries()).map(([type, amount]) => ({
        type: type as any,
        typeName: courseTypeNames[type as keyof typeof courseTypeNames] || '未知',
        amount,
        percentage: calculatePercentage(amount, total)
      })),
      bySourceType: Array.from(bySourceType.entries()).map(([sourceType, amount]) => ({
        sourceType: sourceType as any,
        sourceName: sourceTypeNames[sourceType as keyof typeof sourceTypeNames] || '未知',
        amount,
        percentage: calculatePercentage(amount, total)
      })),
      byServiceType: Array.from(byServiceType.entries()).map(([serviceType, amount]) => ({
        serviceType: serviceType as any,
        serviceName: serviceTypeNames[serviceType as keyof typeof serviceTypeNames] || '未知',
        amount,
        percentage: calculatePercentage(amount, total)
      })),
      byInstitution: Array.from(byInstitution.entries()).map(([instId, amount]) => {
        const inst = this.data.institutions.find(i => i.id === instId);
        return {
          institutionId: instId,
          institutionName: inst?.name || '未知机构',
          amount,
          percentage: calculatePercentage(amount, total)
        };
      }),
      byMonth: Array.from(byMonth.entries()).map(([month, amount]) => ({
        month,
        amount
      }))
    };
  }

  getStudentTuitionStats(startDate: string, endDate: string): StudentTuitionStats[] {
    const schedules = this.data.schedules.filter(s => 
      s.status !== ScheduleStatus.CANCELLED &&
      s.status !== ScheduleStatus.LEAVE &&
      s.start_time >= startDate && s.start_time <= endDate
    );

    const studentStats = new Map();

    schedules.forEach(schedule => {
      const studentIds = schedule.student_ids || [];
      const tuition = schedule.calculated_tuition || 0;
      const perStudentTuition = studentIds.length > 0 ? tuition / studentIds.length : tuition;

      studentIds.forEach(studentId => {
        if (!studentStats.has(studentId)) {
          studentStats.set(studentId, { total: 0, byCourseType: new Map() });
        }
        
        const stats = studentStats.get(studentId)!;
        stats.total += perStudentTuition;

        const course = this.data.courses.find(c => c.id === schedule.course_id);
        if (course) {
          stats.byCourseType.set(course.type, (stats.byCourseType.get(course.type) || 0) + perStudentTuition);
        }
      });
    });

    const courseTypeNames = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };

    // @ts-ignore - 原项目类型错误，保持原样
    return Array.from(studentStats.entries()).map(([studentId, stats]) => {
      const student = this.data.students.find(s => s.id === studentId);
      return {
        studentId,
        studentName: student?.name || '未知学生',
        total: stats.total,
        // @ts-ignore - 原项目类型错误，保持原样
      byCourseType: Array.from(stats.byCourseType.entries()).map(([type, amount]) => ({
          type: type as any,
          typeName: courseTypeNames[type as keyof typeof courseTypeNames] || '未知',
          amount
        }))
      };
    // @ts-ignore - 原项目类型错误，保持原样
    }).sort((a, b) => b.total - a.total);
  }

  // ========== 老师管理 ==========
  
  getAllTeachers(): Teacher[] {
    return this.data.teachers;
  }

  getTeacherById(id: string): Teacher | undefined {
    return this.data.teachers.find(t => t.id === id);
  }

  createTeacher(teacher: Omit<Teacher, 'id' | 'created_at' | 'updated_at'>): Teacher {
    const now = new Date().toISOString();
    const newTeacher: Teacher = {
      ...teacher,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    this.data.teachers.push(newTeacher);
    this.recordAuthorityDraft('teachers', 'create', newTeacher.id, newTeacher);
    this.saveData();
    return newTeacher;
  }

  updateTeacher(id: string, updates: Partial<Omit<Teacher, 'id' | 'created_at' | 'updated_at'>>): Teacher | undefined {
    const index = this.data.teachers.findIndex(t => t.id === id);
    if (index !== -1) {
      const baseVersion = this.data.teachers[index].updated_at || null;
      this.data.teachers[index] = {
        ...this.data.teachers[index],
        ...updates,
        updated_at: new Date().toISOString()
      };
      this.recordAuthorityDraft('teachers', 'update', id, this.data.teachers[index], baseVersion);
      this.saveData();
      return this.data.teachers[index];
    }
    return undefined;
  }

  deleteTeacher(id: string): void {
    const existing = this.data.teachers.find(t => t.id === id);
    if (!existing) return;
    const baseVersion = existing.updated_at || null;
    this.data.teachers = this.data.teachers.filter(t => t.id !== id);
    this.recordAuthorityDraft('teachers', 'delete', id, { id }, baseVersion);
    this.saveData();
  }

  // ========== 缴费记录管理 ==========
  
  getAllPayments(): Payment[] {
    return this.data.payments;
  }

  getPaymentById(id: string): Payment | undefined {
    return this.data.payments.find(p => p.id === id);
  }

  getPaymentsByStudentId(studentId: string): Payment[] {
    return this.data.payments.filter(p => p.student_id === studentId);
  }

  createPayment(payment: Omit<Payment, 'id' | 'created_at'>): Payment {
    const now = new Date().toISOString();
    const newPayment: Payment = {
      ...payment,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    this.data.payments.push(newPayment);
    this.recordAuthorityDraft('payments', 'create', newPayment.id, newPayment);
    this.saveData();
    return newPayment;
  }

  updatePayment(id: string, updates: Partial<Omit<Payment, 'id' | 'created_at'>>): Payment | undefined {
    const index = this.data.payments.findIndex(p => p.id === id);
    if (index !== -1) {
      const baseVersion = this.data.payments[index].updated_at || this.data.payments[index].created_at || null;
      this.data.payments[index] = {
        ...this.data.payments[index],
        ...updates,
        updated_at: new Date().toISOString()
      };
      this.recordAuthorityDraft('payments', 'update', id, this.data.payments[index], baseVersion);
      this.saveData();
      return this.data.payments[index];
    }
    return undefined;
  }

  deletePayment(id: string): void {
    const existing = this.data.payments.find(p => p.id === id);
    if (!existing) return;
    const baseVersion = existing.updated_at || existing.created_at || null;
    this.data.payments = this.data.payments.filter(p => p.id !== id);
    this.recordAuthorityDraft('payments', 'delete', id, { id }, baseVersion);
    this.saveData();
  }

  // ========== 课时消耗记录管理 ==========
  
  getAllConsumptions(): Consumption[] {
    return this.data.consumptions;
  }

  getConsumptionById(id: string): Consumption | undefined {
    return this.data.consumptions.find(c => c.id === id);
  }

  getConsumptionsByStudentId(studentId: string): Consumption[] {
    return this.data.consumptions.filter(c => c.student_id === studentId);
  }

  createConsumption(consumption: Omit<Consumption, 'id' | 'created_at'>): Consumption {
    const now = new Date().toISOString();
    const newConsumption: Consumption = {
      ...consumption,
      id: this.generateId(),
      created_at: now,
      updated_at: now
    };
    this.data.consumptions.push(newConsumption);
    this.recordAuthorityDraft('consumptions', 'create', newConsumption.id, newConsumption);
    this.saveData();
    return newConsumption;
  }

  updateConsumption(id: string, updates: Partial<Omit<Consumption, 'id' | 'created_at'>>): Consumption | undefined {
    const index = this.data.consumptions.findIndex(c => c.id === id);
    if (index !== -1) {
      const baseVersion = this.data.consumptions[index].updated_at || this.data.consumptions[index].created_at || null;
      this.data.consumptions[index] = {
        ...this.data.consumptions[index],
        ...updates,
        updated_at: new Date().toISOString()
      };
      this.recordAuthorityDraft('consumptions', 'update', id, this.data.consumptions[index], baseVersion);
      this.saveData();
      return this.data.consumptions[index];
    }
    return undefined;
  }

  deleteConsumption(id: string): void {
    const existing = this.data.consumptions.find(c => c.id === id);
    if (!existing) return;
    const baseVersion = existing.updated_at || existing.created_at || null;
    this.data.consumptions = this.data.consumptions.filter(c => c.id !== id);
    this.recordAuthorityDraft('consumptions', 'delete', id, { id }, baseVersion);
    this.saveData();
  }

  // ========== 数据导出/导入 ==========
  
  exportAllData(): Database & { exported_at: string } {
    return {
      ...this.data,
      exported_at: new Date().toISOString()
    };
  }

  importAllData(data: any): void {
    this.createBusinessDataSafetyBackup('before-importAllData');
    this.data = {
      students: data.students || [],
      student_contacts: data.student_contacts || [],
      grades: data.grades || [],
      courses: data.courses || [],
      schedules: data.schedules || [],
      enrollments: data.enrollments || [],
      payments: data.payments || [],
      consumptions: data.consumptions || [],
      institutions: data.institutions || [],
      schools: data.schools || [],
      rooms: data.rooms || [],
      teachers: data.teachers || [],
      assetRecords: data.assetRecords || [],
      assetCategories: data.assetCategories || [],
      questions: data.questions || [],
      knowledgeTree: data.knowledgeTree || [],
      modelTree: data.modelTree || [],
      taxonomySystems: data.taxonomySystems || [],
      taxonomyInitialized: data.taxonomyInitialized === true,
      taxonomy_systems: data.taxonomy_systems || [],
      taxonomy_nodes: data.taxonomy_nodes || [],
      tags: data.tags || [],
      questionTagRels: data.questionTagRels || [],
      questionBasketIds: data.questionBasketIds || [],
      questionVersions: data.questionVersions || [],
      importTasks: data.importTasks || [],
      importTaskItems: data.importTaskItems || []
    };
    this.migrateLegacyQuestionData();
    this.migrateLegacyTagData();
    this.migrateQuestionVersionData();
    this.migrateImportTaskData();
    this.saveData();
  }

  buildSyncLocalDataMaps(): SyncLocalDataMaps {
    return SYNC_TABLES.reduce<SyncLocalDataMaps>((maps, table) => {
      const records = (this.data[table] || []) as Array<{ id?: string; [key: string]: any }>;
      const syncableRecords = records.filter((record): record is { id: string; [key: string]: any } => Boolean(record?.id));
      maps[table] = new Map(
        syncableRecords.map(record => [record.id, { ...record }])
      );
      return maps;
    }, {});
  }

  applySyncLocalDataMaps(localData: SyncLocalDataMaps): void {
    for (const table of SYNC_TABLES) {
      const map = localData[table];
      if (!map) continue;
      this.data[table] = (table === 'questions' ? applyQuestionSyncRecords(map) : Array.from(map.values()).map(record => {
        const { _synced, ...cleanRecord } = record || {};
        return cleanRecord;
      })) as any;
    }
    this.hydrateTaxonomiesFromSyncRows();
    this.saveData();
  }

  // ========== 资产统计管理 ==========

  getAllAssetRecords(): AssetRecord[] {
    return this.data.assetRecords;
  }

  getAssetRecordsByDateRange(startDate: string, endDate: string): AssetRecord[] {
    return this.data.assetRecords.filter(r => r.date >= startDate && r.date <= endDate);
  }

  createAssetRecord(record: Omit<AssetRecord, 'id' | 'created_at' | 'updated_at'>): AssetRecord {
    const now = new Date().toISOString();
    const newRecord: AssetRecord = {
      ...record,
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      created_at: now,
      updated_at: now
    };
    this.data.assetRecords.push(newRecord);
    this.recordAuthorityDraft('assetRecords', 'create', newRecord.id, newRecord);
    this.saveData();
    return newRecord;
  }

  updateAssetRecord(id: string, updates: Partial<Omit<AssetRecord, 'id' | 'created_at'>>): boolean {
    const idx = this.data.assetRecords.findIndex(r => r.id === id);
    if (idx === -1) return false;
    const baseVersion = this.data.assetRecords[idx].updated_at || this.data.assetRecords[idx].created_at || null;
    this.data.assetRecords[idx] = { ...this.data.assetRecords[idx], ...updates, updated_at: new Date().toISOString() };
    this.recordAuthorityDraft('assetRecords', 'update', id, this.data.assetRecords[idx], baseVersion);
    this.saveData();
    return true;
  }

  deleteAssetRecord(id: string): boolean {
    const idx = this.data.assetRecords.findIndex(r => r.id === id);
    if (idx === -1) return false;
    const baseVersion = this.data.assetRecords[idx].updated_at || this.data.assetRecords[idx].created_at || null;
    this.data.assetRecords.splice(idx, 1);
    this.recordAuthorityDraft('assetRecords', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  // ========== 资产分类管理 ==========

  getAllAssetCategories(): AssetCategory[] {
    return this.data.assetCategories;
  }

  getAssetCategoriesByType(type: 'income' | 'expense'): AssetCategory[] {
    return this.data.assetCategories.filter(c => c.type === type);
  }

  createAssetCategory(cat: Omit<AssetCategory, 'id' | 'created_at' | 'updated_at'>): AssetCategory {
    const now = new Date().toISOString();
    const newCat: AssetCategory = {
      ...cat,
      id: 'cat-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
      created_at: now,
      updated_at: now
    };
    this.data.assetCategories.push(newCat);
    this.recordAuthorityDraft('assetCategories', 'create', newCat.id, newCat);
    this.saveData();
    return newCat;
  }

  deleteAssetCategory(id: string): boolean {
    if (id.startsWith('builtin-')) return false; // 内置分类不可删除
    const idx = this.data.assetCategories.findIndex(c => c.id === id);
    if (idx === -1) return false;
    const baseVersion = this.data.assetCategories[idx].updated_at || this.data.assetCategories[idx].created_at || null;
    this.data.assetCategories.splice(idx, 1);
    this.recordAuthorityDraft('assetCategories', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  // ========== 资产统计 ==========

  getAssetStats(startDate: string, endDate: string): AssetStats {
    const records = this.data.assetRecords.filter(r => r.date >= startDate && r.date <= endDate);
    const income = records.filter(r => r.type === 'income');
    const expense = records.filter(r => r.type === 'expense');
    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expense.reduce((s, r) => s + r.amount, 0);

    // 按分类汇总
    const incomeByCat = new Map<string, { amount: number; count: number }>();
    const expenseByCat = new Map<string, { amount: number; count: number }>();
    for (const r of income) {
      const prev = incomeByCat.get(r.category_name) || { amount: 0, count: 0 };
      incomeByCat.set(r.category_name, { amount: prev.amount + r.amount, count: prev.count + 1 });
    }
    for (const r of expense) {
      const prev = expenseByCat.get(r.category_name) || { amount: 0, count: 0 };
      expenseByCat.set(r.category_name, { amount: prev.amount + r.amount, count: prev.count + 1 });
    }

    // 月度趋势
    const monthlyMap = new Map<string, { income: number; expense: number }>();
    for (const r of records) {
      const month = r.date.substring(0, 7);
      const prev = monthlyMap.get(month) || { income: 0, expense: 0 };
      if (r.type === 'income') prev.income += r.amount;
      else prev.expense += r.amount;
      monthlyMap.set(month, prev);
    }

    return {
      totalIncome,
      totalExpense,
      netAmount: totalIncome - totalExpense,
      incomeByCategory: Array.from(incomeByCat.entries()).map(([k, v]) => ({ category: k, ...v })),
      expenseByCategory: Array.from(expenseByCat.entries()).map(([k, v]) => ({ category: k, ...v })),
      monthlyTrend: Array.from(monthlyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ month: k, ...v }))
    };
  }

  // ========== 成绩管理 ==========

  getAllGrades(): Grade[] {
    return this.data.grades;
  }

  getGradesByStudentId(studentId: string): Grade[] {
    return this.data.grades.filter(g => g.student_id === studentId);
  }

  createGrade(grade: Omit<Grade, 'id' | 'created_at' | 'updated_at'>): Grade {
    const now = new Date().toISOString();
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const newGrade: Grade = { ...grade, id, created_at: now, updated_at: now };
    this.data.grades.push(newGrade);
    this.recordAuthorityDraft('grades', 'create', newGrade.id, newGrade);
    this.saveData();
    return newGrade;
  }

  deleteGrade(id: string): boolean {
    const idx = this.data.grades.findIndex(g => g.id === id);
    if (idx === -1) return false;
    const baseVersion = this.data.grades[idx].updated_at || this.data.grades[idx].created_at || null;
    this.data.grades.splice(idx, 1);
    this.recordAuthorityDraft('grades', 'delete', id, { id }, baseVersion);
    this.saveData();
    return true;
  }

  getPerformanceStats(): { subjectStats: { subject: string; avgScore: number; max: number; min: number; count: number }[]; totalExams: number } {
    const grades = this.data.grades;
    const bySubject = new Map<string, { sum: number; max: number; min: number; count: number }>();
    for (const g of grades) {
      const prev = bySubject.get(g.subject) || { sum: 0, max: -Infinity, min: Infinity, count: 0 };
      prev.sum += g.score;
      prev.max = Math.max(prev.max, g.score);
      prev.min = Math.min(prev.min, g.score);
      prev.count++;
      bySubject.set(g.subject, prev);
    }
    return {
      subjectStats: Array.from(bySubject.entries()).map(([k, v]) => ({
        subject: k,
        avgScore: Math.round(v.sum / v.count * 10) / 10,
        max: v.max,
        min: v.min,
        count: v.count
      })),
      totalExams: grades.length
    };
  }

  // ========== 题库管理 ==========

  getAllQuestions(): Question[] {
    const now = Date.now();
    const keepMs = 7 * 24 * 60 * 60 * 1000;
    const before = this.data.questions.length;
    this.data.questions = this.data.questions.filter(q => {
      if (!(q as any).deleted) return true;
      const deletedAt = Date.parse((q as any).deleted_at || '');
      return Number.isFinite(deletedAt) && now - deletedAt <= keepMs;
    });
    if (this.data.questions.length !== before) this.saveData();
    return this.data.questions.filter(q => !(q as any).deleted);
  }

  getQuestionSearchText(id: string): string {
    const cached = this.questionSearchIndex.get(id);
    if (cached !== undefined) return cached;
    const question = this.data.questions.find(item => item.id === id);
    return question ? this.questionIndexText(question) : '';
  }

  getDeletedQuestions(): Question[] {
    const now = Date.now();
    const keepMs = 7 * 24 * 60 * 60 * 1000;
    return this.data.questions
      .filter(q => {
        if (!(q as any).deleted) return false;
        const deletedAt = Date.parse((q as any).deleted_at || '');
        return Number.isFinite(deletedAt) && now - deletedAt <= keepMs;
      })
      .sort((a, b) => String((b as any).deleted_at || '').localeCompare(String((a as any).deleted_at || '')));
  }

  getQuestionsByStatus(status: Question['status']): Question[] {
    return this.data.questions.filter(q => (q.status || 'draft') === status);
  }

  updateQuestionStatus(id: string, status: Question['status']): Question | null {
    const idx = this.data.questions.findIndex(q => q.id === id);
    if (idx === -1) return null;
    this.createQuestionVersionSnapshot(this.data.questions[idx], '状态变更前快照');
    this.data.questions[idx] = this.normalizeQuestionRecord({
      ...this.data.questions[idx],
      status,
      updated_at: new Date().toISOString()
    });
    this.recordAuthorityDraft('questions', 'update', id, this.data.questions[idx]);
    this.saveData();
    return this.data.questions[idx];
  }

  getQuestionBasketIds(): string[] {
    return Array.from(new Set((this.data.questionBasketIds || []).filter(Boolean)));
  }

  setQuestionBasketIds(ids: string[]): string[] {
    const knownIds = new Set((this.data.questions || []).map(q => q.id));
    const nextIds = Array.from(new Set((ids || []).filter(id => id && (knownIds.size === 0 || knownIds.has(id)))));
    this.data.questionBasketIds = nextIds;
    this.saveData();
    return nextIds;
  }

  clearQuestionBankData(): void {
    this.data.questions = [];
    this.data.questionVersions = [];
    this.data.questionBasketIds = [];
    this.data.importTasks = [];
    this.data.importTaskItems = [];
    this.questionSearchIndex.clear();
    clearQuestionLocalStore().catch(() => undefined);
    this.syncTreeCache();
    this.saveData();
  }

  toggleQuestionBasket(id: string): string[] {
    const current = this.getQuestionBasketIds();
    const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
    return this.setQuestionBasketIds(next);
  }

  getQuestionsBySubject(subject: string): Question[] {
    return this.data.questions.filter(q => q.subject === subject);
  }

  createImportTask(payload: Partial<ImportTask> & { items?: Array<Partial<ImportTaskItem>> }): ImportTask {
    const now = new Date().toISOString();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const normalizedItems = items.map((item, index) => this.normalizeImportTaskItem({
      ...item,
      task_id: payload.id || item.task_id || '',
      item_index: item.item_index ?? index,
      created_at: item.created_at || now,
      updated_at: item.updated_at || now,
    }));
    const taskId = payload.id || this.generateId();
    const warningItems = normalizedItems.filter(item => item.status === 'warning' || item.warnings.length > 0).length;
    const failedItems = normalizedItems.filter(item => item.status === 'failed' || item.status === 'rejected' || item.errors.length > 0).length;
    const duplicateItems = normalizedItems.filter(item => item.status === 'duplicate').length;
    const successItems = normalizedItems.filter(item =>
      ['success', 'accepted', 'imported'].includes(item.status) && item.errors.length === 0
    ).length;
    const task = this.normalizeImportTask({
      ...payload,
      id: taskId,
      status: payload.status || 'checked',
      total_items: payload.total_items ?? normalizedItems.length,
      success_items: payload.success_items ?? successItems,
      warning_items: payload.warning_items ?? warningItems,
      failed_items: payload.failed_items ?? failedItems,
      duplicate_items: payload.duplicate_items ?? duplicateItems,
      created_at: payload.created_at || now,
      updated_at: payload.updated_at || now,
    });
    this.data.importTasks = [task, ...(this.data.importTasks || []).filter(item => item.id !== task.id)];
    this.data.importTaskItems = [
      ...(this.data.importTaskItems || []).filter(item => item.task_id !== task.id),
      ...normalizedItems.map(item => ({ ...item, task_id: task.id })),
    ];
    this.saveData();
    return task;
  }

  updateImportTask(id: string, updates: Partial<ImportTask>): ImportTask | undefined {
    const idx = (this.data.importTasks || []).findIndex(task => task.id === id);
    if (idx === -1) return undefined;
    this.data.importTasks[idx] = this.normalizeImportTask({
      ...this.data.importTasks[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    });
    this.saveData();
    return this.data.importTasks[idx];
  }

  addImportTaskItems(taskId: string, items: Array<Partial<ImportTaskItem>>): ImportTaskItem[] {
    const now = new Date().toISOString();
    const existingCount = (this.data.importTaskItems || []).filter(item => item.task_id === taskId).length;
    const normalized = (items || []).map((item, index) => this.normalizeImportTaskItem({
      ...item,
      task_id: taskId,
      item_index: item.item_index ?? existingCount + index,
      created_at: item.created_at || now,
      updated_at: item.updated_at || now,
    }));
    this.data.importTaskItems = [...(this.data.importTaskItems || []), ...normalized];
    const task = this.data.importTasks.find(item => item.id === taskId);
    if (task) {
      const taskItems = this.getImportTaskItems(taskId);
      task.total_items = taskItems.length;
      task.success_items = taskItems.filter(item => ['success', 'accepted', 'imported'].includes(item.status) && item.errors.length === 0).length;
      task.warning_items = taskItems.filter(item => item.status === 'warning' || item.warnings.length > 0).length;
      task.failed_items = taskItems.filter(item => item.status === 'failed' || item.status === 'rejected' || item.errors.length > 0).length;
      task.duplicate_items = taskItems.filter(item => item.status === 'duplicate').length;
      task.updated_at = now;
    }
    this.saveData();
    return normalized;
  }

  getRecentImportTasks(limit = 10): ImportTask[] {
    return [...(this.data.importTasks || [])]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, Math.max(1, limit));
  }

  getImportTaskItems(taskId: string): ImportTaskItem[] {
    return (this.data.importTaskItems || [])
      .filter(item => item.task_id === taskId)
      .sort((a, b) => a.item_index - b.item_index);
  }

  getImportTaskDetail(taskId: string): (ImportTask & { items: ImportTaskItem[] }) | null {
    const task = (this.data.importTasks || []).find(item => item.id === taskId);
    if (!task) return null;
    return { ...task, items: this.getImportTaskItems(taskId) };
  }

  getTaxonomySystems(subject?: string): TaxonomySystem[] {
    return [...(this.data.taxonomySystems || [])]
      .filter(system => !subject || system.subject === subject)
      .sort((a, b) => a.sort_no - b.sort_no || a.name.localeCompare(b.name));
  }

  createTaxonomySystem(input: { name: string; subject: string; sort_no?: number }): TaxonomySystem {
    const name = String(input.name || '').trim();
    const subject = String(input.subject || '').trim();
    if (!name || !subject) throw new Error('TAXONOMY_SYSTEM_NAME_AND_SUBJECT_REQUIRED');
    if (this.getTaxonomySystems(subject).some(system => system.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('TAXONOMY_SYSTEM_NAME_DUPLICATE');
    }
    const now = new Date().toISOString();
    const system: TaxonomySystem = {
      id: `taxonomy-${this.generateId()}`,
      name,
      subject,
      sort_no: input.sort_no ?? this.getTaxonomySystems(subject).length + 1,
      created_at: now,
      updated_at: now,
    };
    this.data.taxonomySystems.push(system);
    this.syncTaxonomySyncRowsFromCanonical();
    this.recordAuthorityDraft('taxonomy_systems', 'create', system.id, {
      subject: system.subject, name: system.name, sort_order: system.sort_no,
      deleted: 0, created_at: system.created_at, updated_at: system.updated_at,
    });
    this.saveData();
    return system;
  }

  updateTaxonomySystem(id: string, updates: Partial<Pick<TaxonomySystem, 'name' | 'sort_no'>>): TaxonomySystem | undefined {
    const index = this.data.taxonomySystems.findIndex(system => system.id === id);
    if (index === -1) return undefined;
    const current = this.data.taxonomySystems[index];
    const name = updates.name === undefined ? current.name : String(updates.name).trim();
    if (!name) throw new Error('TAXONOMY_SYSTEM_NAME_REQUIRED');
    if (this.getTaxonomySystems(current.subject).some(system => system.id !== id && system.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('TAXONOMY_SYSTEM_NAME_DUPLICATE');
    }
    this.data.taxonomySystems[index] = {
      ...current,
      ...updates,
      name,
      updated_at: new Date().toISOString(),
    };
    this.syncTaxonomySyncRowsFromCanonical();
    const updated = this.data.taxonomySystems[index];
    this.recordAuthorityDraft('taxonomy_systems', 'update', id, {
      subject: updated.subject, name: updated.name, sort_order: updated.sort_no,
      deleted: 0, created_at: updated.created_at, updated_at: updated.updated_at,
    }, current.updated_at || null);
    this.saveData();
    return this.data.taxonomySystems[index];
  }

  private readTaxonomyDeletionBackups(): any[] {
    try {
      const raw = localStorage.getItem(this.identityStorageKey(TAXONOMY_DELETION_BACKUP_KEY));
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persistTaxonomyDeletionBackup(record: any): void {
    const key = this.identityStorageKey(TAXONOMY_DELETION_BACKUP_KEY);
    const backups = [record, ...this.readTaxonomyDeletionBackups()].slice(0, TAXONOMY_DELETION_BACKUP_LIMIT);
    localStorage.setItem(key, JSON.stringify(backups));
  }

  private appendTaxonomyDeletionAudit(backupId: string, status: 'success' | 'failed', error?: unknown): void {
    const key = this.identityStorageKey(TAXONOMY_DELETION_BACKUP_KEY);
    const backups = this.readTaxonomyDeletionBackups();
    const index = backups.findIndex(backup => backup.id === backupId);
    if (index === -1) return;
    backups[index] = {
      ...backups[index],
      audit_events: [
        ...(Array.isArray(backups[index].audit_events) ? backups[index].audit_events : []),
        {
          action: 'taxonomy_cascade_delete',
          status,
          at: new Date().toISOString(),
          ...(status === 'failed' ? { error: String((error as any)?.message || error || 'unknown') } : {}),
        },
      ],
    };
    localStorage.setItem(key, JSON.stringify(backups));
  }

  private requireTaxonomyDeletionConfirmation(options: any, affectedQuestionCount: number): void {
    if (options?.confirmed !== true || !Number.isInteger(Number(options?.expectedAffectedQuestionCount))) {
      throw new Error('TAXONOMY_DELETE_CONFIRMATION_REQUIRED');
    }
    if (Number(options.expectedAffectedQuestionCount) !== affectedQuestionCount) {
      throw new Error('TAXONOMY_DELETE_IMPACT_CHANGED');
    }
  }

  getTaxonomySystemDeletionImpact(id: string): any | null {
    const system = this.data.taxonomySystems.find(item => item.id === id);
    if (!system) return null;
    const nodeIds = new Set(this.data.tags.filter(tag => tag.tag_type === id).map(tag => tag.id));
    const affectedQuestionIds = new Set(this.data.questionTagRels
      .filter(rel => rel.tag_type === id && nodeIds.has(rel.tag_id))
      .map(rel => rel.question_id));
    for (const question of this.data.questions) {
      if ((question.taxonomy_ids?.[id] || []).length > 0) affectedQuestionIds.add(question.id);
    }
    return {
      entity_type: 'system', system_id: id, system_name: system.name,
      affected_question_count: affectedQuestionIds.size, deleted_node_count: nodeIds.size,
    };
  }

  getTaxonomyNodeDeletionImpact(systemId: string, id: string): any | null {
    const nodes = this.collectTagDescendantIds(id, systemId);
    if (nodes.length === 0) return null;
    const nodeIds = new Set(nodes.map(node => node.id));
    const affectedQuestionIds = new Set(this.data.questionTagRels
      .filter(rel => rel.tag_type === systemId && nodeIds.has(rel.tag_id))
      .map(rel => rel.question_id));
    for (const question of this.data.questions) {
      if ((question.taxonomy_ids?.[systemId] || []).some(nodeId => nodeIds.has(nodeId))) affectedQuestionIds.add(question.id);
    }
    return {
      entity_type: 'node', system_id: systemId, node_id: id,
      affected_question_count: affectedQuestionIds.size, deleted_node_count: nodeIds.size,
    };
  }

  deleteTaxonomySystem(id: string, options: any = {}): any | null {
    const system = this.data.taxonomySystems.find(item => item.id === id);
    if (!system) return null;
    const impact = this.getTaxonomySystemDeletionImpact(id)!;
    this.requireTaxonomyDeletionConfirmation(options, impact.affected_question_count);
    const nodes = this.data.tags.filter(tag => tag.tag_type === id);
    const annotations = this.data.questions.map(question => ({
      question_id: question.id,
      node_ids: [...new Set([
        ...(question.taxonomy_ids?.[id] || []),
        ...this.data.questionTagRels.filter(rel => rel.question_id === question.id && rel.tag_type === id).map(rel => rel.tag_id),
      ])],
    })).filter(annotation => annotation.node_ids.length > 0);
    const backupId = `taxonomy-deletion-${this.generateId()}`;
    const backup = {
      id: backupId, entity_type: 'system', system_id: id, node_id: null,
      affected_question_count: impact.affected_question_count, deleted_node_count: nodes.length,
      created_at: new Date().toISOString(), restored_at: null,
      audit_events: [{ action: 'taxonomy_cascade_delete', status: 'pending', at: new Date().toISOString() }],
      snapshot: { system, nodes, annotations },
    };
    this.persistTaxonomyDeletionBackup(backup);
    const before = JSON.parse(JSON.stringify(this.data)) as Database;
    const affectedQuestionIds = new Set(annotations.map(item => item.question_id));
    try {
      this.data.taxonomySystems = this.data.taxonomySystems.filter(item => item.id !== id);
      this.data.tags = this.data.tags.filter(tag => tag.tag_type !== id);
      this.data.questionTagRels = this.data.questionTagRels.filter(rel => rel.tag_type !== id);
      if (id === 'knowledge') this.data.knowledgeTree = [];
      if (id === 'model') this.data.modelTree = [];
      for (const question of this.data.questions) {
        if (question.taxonomy_ids) delete question.taxonomy_ids[id];
        if (id === 'knowledge') {
          question.knowledge_ids = [];
          question.knowledge_point_ids = [];
          question.knowledge_point = '';
        }
        if (id === 'model') {
          question.model_ids = [];
          question.model_point_ids = [];
          question.model_point = '';
        }
        if (affectedQuestionIds.has(question.id)) {
          question.updated_at = new Date().toISOString();
        }
      }
      this.syncTaxonomySyncRowsFromCanonical();
      this.recordAuthorityDraft('taxonomy_systems', 'delete', id, {
        subject: system.subject, name: system.name, sort_order: system.sort_no,
        deleted: 1, created_at: system.created_at, updated_at: new Date().toISOString(),
        _taxonomy_delete_confirmation: {
          confirmed: true,
          expected_affected_question_count: impact.affected_question_count,
        },
      }, system.updated_at || null);
      this.saveData();
      this.appendTaxonomyDeletionAudit(backupId, 'success');
    } catch (error) {
      this.data = before;
      try { this.saveData(); } catch (_rollbackError) {}
      try { this.appendTaxonomyDeletionAudit(backupId, 'failed', error); } catch (_auditError) {}
      throw error;
    }
    return { deleted: true, backup_id: backupId, ...impact };
  }

  getTaxonomyNodes(systemId: string): KnowledgeNode[] {
    return tagsToLegacyTree(this.data.tags || [], systemId, []);
  }

  createTaxonomyNode(systemId: string, node: Omit<KnowledgeNode, 'id' | 'created_at' | 'updated_at'>): KnowledgeNode {
    const system = this.data.taxonomySystems.find(item => item.id === systemId);
    if (!system) throw new Error('TAXONOMY_SYSTEM_NOT_FOUND');
    const now = new Date().toISOString();
    const created: KnowledgeNode = {
      ...node,
      id: `taxonomy-node-${this.generateId()}`,
      created_at: now,
      updated_at: now,
    };
    this.createTag({
      id: created.id,
      tag_type: systemId,
      tag_name: created.name,
      tag_code: created.id,
      parent_id: created.parent_id,
      subject: system.subject,
      sort_no: created.order,
      status: 1,
    }, false);
    this.syncTaxonomySyncRowsFromCanonical();
    this.recordAuthorityDraft('taxonomy_nodes', 'create', created.id, {
      system_id: systemId, parent_id: created.parent_id || null, name: created.name,
      sort_order: created.order, deleted: 0, created_at: created.created_at, updated_at: created.updated_at,
    });
    this.saveData();
    return created;
  }

  updateTaxonomyNode(systemId: string, id: string, updates: Partial<Omit<KnowledgeNode, 'id'>>): boolean {
    const current = this.data.tags.find(tag => tag.id === id && tag.tag_type === systemId);
    const updated = this.updateTag(id, {
      ...(updates.name === undefined ? {} : { tag_name: String(updates.name).trim() }),
      ...(updates.parent_id === undefined ? {} : { parent_id: updates.parent_id }),
      ...(updates.order === undefined ? {} : { sort_no: updates.order }),
    }, systemId, false);
    if (updated) {
      this.syncTaxonomySyncRowsFromCanonical();
      this.recordAuthorityDraft('taxonomy_nodes', 'update', id, {
        system_id: systemId, parent_id: updated.parent_id || null, name: updated.tag_name,
        sort_order: updated.sort_no, deleted: 0, created_at: updated.created_at, updated_at: updated.updated_at,
      }, current?.updated_at || null);
      this.saveData();
    }
    return Boolean(updated);
  }

  deleteTaxonomyNode(systemId: string, id: string, options: any = {}): any | null {
    const rows = this.collectTagDescendantIds(id, systemId)
      .map(item => this.data.tags.find(tag => tag.id === item.id && tag.tag_type === item.tag_type))
      .filter((tag): tag is Tag => Boolean(tag));
    if (rows.length === 0) return null;
    const impact = this.getTaxonomyNodeDeletionImpact(systemId, id)!;
    this.requireTaxonomyDeletionConfirmation(options, impact.affected_question_count);
    const nodeIds = new Set(rows.map(row => row.id));
    const annotations = this.data.questions.map(question => ({
      question_id: question.id,
      node_ids: [...new Set([
        ...(question.taxonomy_ids?.[systemId] || []).filter(nodeId => nodeIds.has(nodeId)),
        ...this.data.questionTagRels.filter(rel => rel.question_id === question.id && rel.tag_type === systemId && nodeIds.has(rel.tag_id)).map(rel => rel.tag_id),
      ])],
    })).filter(annotation => annotation.node_ids.length > 0);
    const backupId = `taxonomy-deletion-${this.generateId()}`;
    const system = this.data.taxonomySystems.find(item => item.id === systemId);
    this.persistTaxonomyDeletionBackup({
      id: backupId, entity_type: 'node', system_id: systemId, node_id: id,
      affected_question_count: impact.affected_question_count, deleted_node_count: rows.length,
      created_at: new Date().toISOString(), restored_at: null,
      audit_events: [{ action: 'taxonomy_cascade_delete', status: 'pending', at: new Date().toISOString() }],
      snapshot: { system, nodes: rows, annotations },
    });
    const before = JSON.parse(JSON.stringify(this.data)) as Database;
    const affectedQuestionIds = new Set(annotations.map(item => item.question_id));
    try {
      this.data.tags = this.data.tags.filter(tag => !(tag.tag_type === systemId && nodeIds.has(tag.id)));
      this.data.questionTagRels = this.data.questionTagRels.filter(rel => !(rel.tag_type === systemId && nodeIds.has(rel.tag_id)));
      this.syncLegacyTreesFromTags();
      this.syncAllQuestionLegacyTagFields();
      for (const question of this.data.questions.filter(item => affectedQuestionIds.has(item.id))) question.updated_at = new Date().toISOString();
      this.syncTaxonomySyncRowsFromCanonical();
      const root = rows.find(tag => tag.id === id);
      this.recordAuthorityDraft('taxonomy_nodes', 'delete', id, {
        system_id: systemId,
        parent_id: root?.parent_id || null,
        name: root?.tag_name || '',
        sort_order: root?.sort_no || 0,
        _taxonomy_delete_confirmation: {
          confirmed: true,
          expected_affected_question_count: impact.affected_question_count,
        },
      }, root?.updated_at || null);
      this.saveData();
      this.appendTaxonomyDeletionAudit(backupId, 'success');
    } catch (error) {
      this.data = before;
      try { this.saveData(); } catch (_rollbackError) {}
      try { this.appendTaxonomyDeletionAudit(backupId, 'failed', error); } catch (_auditError) {}
      throw error;
    }
    return { deleted: true, backup_id: backupId, ...impact };
  }

  listTaxonomyDeletionBackups(): any[] {
    return this.readTaxonomyDeletionBackups().map(({ snapshot: _snapshot, ...backup }) => backup);
  }

  restoreTaxonomyDeletion(backupId: string): any | null {
    const backups = this.readTaxonomyDeletionBackups();
    const index = backups.findIndex(backup => backup.id === backupId);
    if (index === -1) return null;
    const backup = backups[index];
    if (backup.restored_at) throw new Error('TAXONOMY_DELETION_ALREADY_RESTORED');
    const snapshot = backup.snapshot;
    if (!snapshot?.system) throw new Error('TAXONOMY_DELETION_BACKUP_INVALID');
    if (backup.entity_type === 'node' && !this.data.taxonomySystems.some(item => item.id === snapshot.system.id)) {
      throw new Error('TAXONOMY_RESTORE_REQUIRES_ACTIVE_SYSTEM');
    }
    const before = JSON.parse(JSON.stringify(this.data)) as Database;
    try {
      if (backup.entity_type === 'system') {
        this.data.taxonomySystems = [
          ...this.data.taxonomySystems.filter(item => item.id !== snapshot.system.id),
          snapshot.system,
        ];
      }
      const restoreKeys = new Set((snapshot.nodes || []).map((node: Tag) => `${node.tag_type}__${node.id}`));
      this.data.tags = [
        ...this.data.tags.filter(tag => !restoreKeys.has(`${tag.tag_type}__${tag.id}`)),
        ...(snapshot.nodes || []),
      ];
      for (const annotation of snapshot.annotations || []) {
        const question = this.data.questions.find(item => item.id === annotation.question_id);
        if (!question) continue;
        question.taxonomy_ids = question.taxonomy_ids || {};
        question.taxonomy_ids[backup.system_id] = [...new Set([
          ...(question.taxonomy_ids[backup.system_id] || []), ...(annotation.node_ids || []),
        ])];
        for (const nodeId of annotation.node_ids || []) {
          if (!this.data.questionTagRels.some(rel => rel.question_id === question.id && rel.tag_type === backup.system_id && rel.tag_id === nodeId)) {
            this.data.questionTagRels.push({
              id: this.generateId(), question_id: question.id, tag_id: nodeId,
              tag_type: backup.system_id, created_at: new Date().toISOString(),
            });
          }
        }
        question.updated_at = new Date().toISOString();
      }
      this.syncLegacyTreesFromTags();
      this.syncAllQuestionLegacyTagFields();
      this.syncTaxonomySyncRowsFromCanonical();
      const restoreChanges: Array<{
        collection: SyncTable;
        action: SyncAction;
        recordId: string;
        value: Record<string, any>;
      }> = [];
      if (backup.entity_type === 'system') {
        restoreChanges.push({
          collection: 'taxonomy_systems',
          action: 'create',
          recordId: snapshot.system.id,
          value: {
            subject: snapshot.system.subject,
            name: snapshot.system.name,
            sort_order: snapshot.system.sort_no,
            deleted: 0,
            created_at: snapshot.system.created_at,
            updated_at: new Date().toISOString(),
          },
        });
      }
      for (const node of snapshot.nodes || []) {
        restoreChanges.push({
          collection: 'taxonomy_nodes',
          action: 'create',
          recordId: node.id,
          value: {
            system_id: node.tag_type,
            parent_id: node.parent_id || null,
            name: node.tag_name,
            sort_order: node.sort_no,
            deleted: 0,
            created_at: node.created_at,
            updated_at: new Date().toISOString(),
          },
        });
      }
      for (const annotation of snapshot.annotations || []) {
        const question = this.data.questions.find(item => item.id === annotation.question_id);
        if (question) {
          restoreChanges.push({
            collection: 'questions',
            action: 'update',
            recordId: question.id,
            value: question,
          });
        }
      }
      this.recordAuthorityDraftBatch(restoreChanges);
      this.saveData();
    } catch (error) {
      this.data = before;
      this.saveData();
      throw error;
    }
    backups[index] = {
      ...backup, restored_at: new Date().toISOString(),
      audit_events: [
        ...(backup.audit_events || []),
        { action: 'taxonomy_cascade_restore', status: 'success', at: new Date().toISOString() },
      ],
    };
    localStorage.setItem(this.identityStorageKey(TAXONOMY_DELETION_BACKUP_KEY), JSON.stringify(backups));
    return { restored: true, backup_id: backupId, affected_question_count: backup.affected_question_count };
  }

  getQuestionTaxonomyNodes(questionId: string, systemId: string): KnowledgeNode[] | null {
    if (!this.data.questions.some(question => question.id === questionId)) return null;
    const ids = new Set(this.getQuestionTagRels(questionId, systemId).map(rel => rel.tag_id));
    return this.getTaxonomyNodes(systemId).filter(node => ids.has(node.id));
  }

  setQuestionTaxonomyNodes(questionId: string, systemId: string, nodeIds: string[]): Question | null {
    return this.setQuestionTagRels(questionId, systemId, nodeIds);
  }

  getAllTags(tagType?: TagType): Tag[] {
    const tags = (this.data.tags || []).filter(tag => tag.status !== 0);
    return tagType ? tags.filter(tag => tag.tag_type === tagType) : tags;
  }

  createTag(tag: Omit<Tag, 'id' | 'created_at' | 'updated_at'> & { id?: string }, persist = true): Tag {
    const now = new Date().toISOString();
    const id = tag.id || this.generateId();
    const newTag: Tag = {
      ...tag,
      id,
      tag_code: tag.tag_code || id,
      sort_no: tag.sort_no || 0,
      status: tag.status ?? 1,
      created_at: now,
      updated_at: now,
    };
    this.data.tags = [...(this.data.tags || []).filter(item => !(item.id === newTag.id && item.tag_type === newTag.tag_type)), newTag];
    this.syncLegacyTreesFromTags();
    if (persist) this.saveData();
    return newTag;
  }

  updateTag(id: string, updates: Partial<Omit<Tag, 'id' | 'created_at'>>, tagType?: TagType, persist = true): Tag | undefined {
    const idx = (this.data.tags || []).findIndex(tag => tag.id === id && (!tagType || tag.tag_type === tagType));
    if (idx === -1) return undefined;
    this.data.tags[idx] = { ...this.data.tags[idx], ...updates, updated_at: new Date().toISOString() };
    this.syncLegacyTreesFromTags();
    this.syncAllQuestionLegacyTagFields();
    if (persist) this.saveData();
    return this.data.tags[idx];
  }

  deleteTag(id: string, tagType?: TagType): boolean {
    const toDelete = this.collectTagDescendantIds(id, tagType);
    if (toDelete.length === 0) return false;
    const deleteKeys = new Set(toDelete.map(item => `${item.tag_type}__${item.id}`));
    const affectedQuestionIds = new Set((this.data.questionTagRels || [])
      .filter(rel => deleteKeys.has(`${rel.tag_type}__${rel.tag_id}`))
      .map(rel => rel.question_id));
    this.data.tags = (this.data.tags || []).filter(tag => !deleteKeys.has(`${tag.tag_type}__${tag.id}`));
    this.data.questionTagRels = (this.data.questionTagRels || []).filter(rel => !deleteKeys.has(`${rel.tag_type}__${rel.tag_id}`));
    this.syncLegacyTreesFromTags();
    this.syncAllQuestionLegacyTagFields();
    const questionChanges: Array<{
      collection: SyncTable;
      action: SyncAction;
      recordId: string;
      value: Record<string, any>;
    }> = [];
    for (const questionId of affectedQuestionIds) {
      const question = this.data.questions.find(item => item.id === questionId);
      if (!question) continue;
      question.updated_at = new Date().toISOString();
      questionChanges.push({
        collection: 'questions',
        action: 'update',
        recordId: questionId,
        value: question,
      });
    }
    this.recordAuthorityDraftBatch(questionChanges);
    for (const questionId of affectedQuestionIds) {
      const question = this.data.questions.find(item => item.id === questionId);
      if (question) this.syncQuestionLocalRecord(question);
    }
    this.saveData();
    return true;
  }

  getQuestionTagRels(questionId?: string, tagType?: TagType): QuestionTagRel[] {
    return (this.data.questionTagRels || []).filter(rel =>
      (!questionId || rel.question_id === questionId) &&
      (!tagType || rel.tag_type === tagType)
    );
  }

  setQuestionTagRels(questionId: string, tagType: TagType, tagIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    this.replaceQuestionTagRels(questionId, tagType, tagIds);
    question.updated_at = new Date().toISOString();
    this.recordAuthorityDraft('questions', 'update', questionId, question);
    this.syncQuestionLocalRecord(question);
    this.saveData();
    return question;
  }

  addQuestionTagRels(questionId: string, tagType: TagType, tagIds: string[]): Question | null {
    const existingIds = this.getQuestionTagRels(questionId, tagType).map(rel => rel.tag_id);
    return this.setQuestionTagRels(questionId, tagType, [...existingIds, ...(tagIds || [])]);
  }

  removeQuestionTagRels(questionId: string, tagType: TagType, tagIds: string[]): Question | null {
    const removeIds = new Set(tagIds || []);
    const nextIds = this.getQuestionTagRels(questionId, tagType)
      .map(rel => rel.tag_id)
      .filter(tagId => !removeIds.has(tagId));
    return this.setQuestionTagRels(questionId, tagType, nextIds);
  }

  private collectTagDescendantIds(id: string, tagType?: TagType): Array<{ id: string; tag_type: TagType }> {
    const roots = (this.data.tags || []).filter(tag => tag.id === id && (!tagType || tag.tag_type === tagType));
    const result: Array<{ id: string; tag_type: TagType }> = [];
    const collect = (tag: Tag) => {
      result.push({ id: tag.id, tag_type: tag.tag_type });
      const children = (this.data.tags || []).filter(child => child.tag_type === tag.tag_type && child.parent_id === tag.id);
      for (const child of children) collect(child);
    };
    for (const root of roots) collect(root);
    return result;
  }

  createQuestion(question: Omit<Question, 'id' | 'created_at' | 'updated_at'>, trustedDraftId?: string): Question {
    const { storage_state: _ignoredStorageState, sourceDeviceId: _ignoredSourceDeviceId, ownerUserId: _ignoredOwnerUserId, ...trustedQuestion } = question;
    const provenanceSafeQuestion = applyTrustedQuestionProvenance(trustedQuestion, { deviceId: this.getSyncDeviceId(), userId: this.getAuthorizationUserId() }) as Omit<Question, 'id' | 'created_at' | 'updated_at'>;
    const now = new Date().toISOString();
    const id = trustedDraftId || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    const content = question.content || '';
    const newQuestion: Question = {
      ...provenanceSafeQuestion,
      id,
      status: question.status || 'draft',
      has_image: question.has_image !== undefined ? question.has_image : /<img|!\[/.test(content),
      has_formula: question.has_formula !== undefined ? question.has_formula : /\$\$|\\\[|\\\(/.test(content),
      created_by: question.created_by || '',
      storage_state: 'local_draft',
      sourceDeviceId: this.getSyncDeviceId(),
      ownerUserId: this.getAuthorizationUserId() || '',
      created_at: now,
      updated_at: now
    };
    const normalizedQuestion = this.normalizeQuestionRecord(newQuestion);
    this.data.questions.push(normalizedQuestion);
    this.syncQuestionRelsFromLegacyFields(normalizedQuestion);
    this.recordAuthorityDraft('questions', 'create', normalizedQuestion.id, normalizedQuestion);
    this.syncQuestionLocalRecord(normalizedQuestion);
    this.saveData();
    return normalizedQuestion;
  }

  private createQuestionVersionSnapshot(question: Question, note = '编辑前快照'): QuestionVersion {
    const existing = (this.data.questionVersions || [])
      .filter(version => version.question_id === question.id)
      .sort((a, b) => a.version_no - b.version_no);
    const version: QuestionVersion = {
      id: this.generateId(),
      question_id: question.id,
      version_no: existing.length + 1,
      snapshot: JSON.parse(JSON.stringify(question)),
      created_at: new Date().toISOString(),
      created_by: question.created_by || '',
      note,
    };
    const next = [...existing, version].slice(-QUESTION_VERSION_LIMIT);
    this.data.questionVersions = [
      ...(this.data.questionVersions || []).filter(item => item.question_id !== question.id),
      ...next.map((item, index) => ({ ...item, version_no: index + 1 })),
    ];
    return version;
  }

  getQuestionVersions(questionId: string): QuestionVersion[] {
    return (this.data.questionVersions || [])
      .filter(version => version.question_id === questionId)
      .sort((a, b) => b.version_no - a.version_no || b.created_at.localeCompare(a.created_at));
  }

  getLatestQuestionVersions(questionId: string, limit = 5): QuestionVersion[] {
    return this.getQuestionVersions(questionId).slice(0, Math.max(1, limit));
  }

  restoreQuestionVersion(questionId: string, versionId: string): Question | null {
    const version = (this.data.questionVersions || []).find(item => item.question_id === questionId && item.id === versionId);
    const idx = this.data.questions.findIndex(q => q.id === questionId);
    if (!version || idx === -1) return null;
    this.createQuestionVersionSnapshot(this.data.questions[idx], `恢复到版本 ${version.version_no} 前快照`);
    const now = new Date().toISOString();
    this.data.questions[idx] = this.normalizeQuestionRecord({
      ...JSON.parse(JSON.stringify(version.snapshot)),
      id: questionId,
      created_at: this.data.questions[idx].created_at,
      updated_at: now,
    });
    this.syncQuestionRelsFromLegacyFields(this.data.questions[idx]);
    this.recordAuthorityDraft('questions', 'update', questionId, this.data.questions[idx]);
    this.syncQuestionLocalRecord(this.data.questions[idx]);
    this.saveData();
    return this.data.questions[idx];
  }

  updateQuestion(id: string, updates: Partial<Omit<Question, 'id' | 'created_at'>>): boolean {
    const idx = this.data.questions.findIndex(q => q.id === id);
    if (idx === -1) return false;
    const { storage_state: _ignoredStorageState, sourceDeviceId: _ignoredSourceDeviceId, ownerUserId: _ignoredOwnerUserId, ...safeUpdates } = updates;
    const provenanceSafeUpdates = applyTrustedQuestionProvenance(safeUpdates, {}, this.data.questions[idx]) as Partial<Question>;
    this.createQuestionVersionSnapshot(this.data.questions[idx]);
    this.data.questions[idx] = this.normalizeQuestionRecord(mergeBrowserQuestionUpdate(this.data.questions[idx], provenanceSafeUpdates as any) as unknown as Question);
    this.data.questions[idx] = {
      ...this.data.questions[idx],
      updated_at: new Date().toISOString()
    };
    if (
      updates.knowledge_ids ||
      updates.model_ids ||
      updates.knowledge_point_ids ||
      updates.model_point_ids
    ) {
      this.syncQuestionRelsFromLegacyFields(this.data.questions[idx]);
    }
    this.recordAuthorityDraft('questions', 'update', id, this.data.questions[idx]);
    this.syncQuestionLocalRecord(this.data.questions[idx]);
    this.saveData();
    return true;
  }

  deleteQuestion(id: string, nativeVerified = false): boolean {
    const idx = this.data.questions.findIndex(q => q.id === id);
    if (idx === -1) return false;
    if (this.data.questions[idx].storage_state === 'host_committed') return false;
    if (nativeVerified !== true) return false;
    let userId = '';
    try {
      try {
        userId = readDesktopAuthorizationSession().authContext.userId;
      } catch {
        userId = readCurrentDesktopIdentityContext().userId;
      }
    } catch (_error) {}
    if (this.data.questions[idx].sourceDeviceId !== this.getSyncDeviceId()
      || !userId || this.data.questions[idx].ownerUserId !== userId) return false;
    this.data.questions[idx] = this.normalizeQuestionRecord({
      ...this.data.questions[idx],
      deleted: true,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Question);
    this.data.questionBasketIds = (this.data.questionBasketIds || []).filter(questionId => questionId !== id);
    this.recordAuthorityDraft('questions', 'delete', id, this.data.questions[idx]);
    this.syncQuestionLocalRecord(this.data.questions[idx]);
    this.syncTreeCache();
    this.saveData();
    return true;
  }

  deleteCloudCachedQuestion(id: string): boolean {
    const idx = this.data.questions.findIndex(q => q.id === id);
    if (idx === -1 || this.data.questions[idx].storage_state !== 'cloud_cached') return false;
    this.data.questions[idx] = this.normalizeQuestionRecord({
      ...this.data.questions[idx],
      deleted: true,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Question);
    this.data.questionBasketIds = (this.data.questionBasketIds || []).filter(questionId => questionId !== id);
    this.recordAuthorityDraft('questions', 'delete', id, this.data.questions[idx]);
    this.syncQuestionLocalRecord(this.data.questions[idx]);
    this.syncTreeCache();
    this.saveData();
    return true;
  }

  restoreQuestion(id: string): boolean {
    const idx = this.data.questions.findIndex(q => q.id === id);
    if (idx === -1) return false;
    this.data.questions[idx] = this.normalizeQuestionRecord({
      ...this.data.questions[idx],
      deleted: false,
      deleted_at: '',
      updated_at: new Date().toISOString(),
    } as Question);
    this.recordAuthorityDraft('questions', 'update', id, this.data.questions[idx]);
    this.syncQuestionLocalRecord(this.data.questions[idx]);
    this.saveData();
    return true;
  }

  // ========== 知识树管理 ==========

  getQuestionKnowledgePoints(questionId: string): KnowledgeNode[] | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    const ids = new Set(this.getQuestionTagRels(questionId, 'knowledge').map(rel => rel.tag_id));
    if (ids.size === 0) {
      for (const id of question.knowledge_ids || []) ids.add(id);
    }
    return this.getKnowledgeTree().filter(node => ids.has(node.id));
  }

  setQuestionKnowledgePoints(questionId: string, knowledgeIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    const knowledgeTree = this.getKnowledgeTree();
    const validIds = new Set(knowledgeTree.map(node => node.id));
    const nextIds = [...new Set((knowledgeIds || []).filter(id => validIds.has(id)))];
    const primary = nextIds.length > 0 ? knowledgeTree.find(node => node.id === nextIds[0]) : null;
    question.knowledge_ids = nextIds;
    question.knowledge_point = primary?.name || '';
    question.updated_at = new Date().toISOString();
    this.replaceQuestionTagRels(questionId, 'knowledge', nextIds);
    this.recordAuthorityDraft('questions', 'update', questionId, question);
    this.syncQuestionLocalRecord(question);
    this.saveData();
    return question;
  }

  addQuestionKnowledgePoints(questionId: string, knowledgeIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    return this.setQuestionKnowledgePoints(questionId, [...(question.knowledge_ids || []), ...(knowledgeIds || [])]);
  }

  removeQuestionKnowledgePoints(questionId: string, knowledgeIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    const removeSet = new Set(knowledgeIds || []);
    return this.setQuestionKnowledgePoints(questionId, (question.knowledge_ids || []).filter(id => !removeSet.has(id)));
  }

  getKnowledgeTree(): KnowledgeNode[] {
    return tagsToLegacyTree(this.data.tags || [], 'knowledge', this.data.knowledgeTree || []);
  }

  getFlatKnowledgeNodes(): { id: string; name: string; path: string }[] {
    const result: { id: string; name: string; path: string }[] = [];
    const buildPath = (nodes: KnowledgeNode[], parentPath: string) => {
      for (const n of nodes) {
        const currentPath = parentPath ? `${parentPath} > ${n.name}` : n.name;
        result.push({ id: n.id, name: n.name, path: currentPath });
        const children = this.getKnowledgeTree().filter(c => c.parent_id === n.id);
        if (children.length > 0) buildPath(children, currentPath);
      }
    };
    const roots = this.getKnowledgeTree().filter(n => !n.parent_id);
    buildPath(roots, '');
    return result;
  }

  initDefaultKnowledgeTree(): void {
    if (!this.data.taxonomySystems.some(system => system.id === 'knowledge')) return;
    if (this.data.knowledgeTree.length > 0) return;
    const now = new Date().toISOString();
    this.data.knowledgeTree = [
      {id:'phy-1',name:'力学',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-1-1',name:'运动学',parent_id:'phy-1',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-1-1-1',name:'匀速直线运动',parent_id:'phy-1-1',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-1-1-2',name:'变速直线运动',parent_id:'phy-1-1',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-1-1-3',name:'曲线运动',parent_id:'phy-1-1',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-1-1-4',name:'相对运动',parent_id:'phy-1-1',children:[],order:4,created_at:now,updated_at:now},
      {id:'phy-1-2',name:'动力学',parent_id:'phy-1',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-1-2-1',name:'牛顿运动定律',parent_id:'phy-1-2',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-1-2-2',name:'受力分析',parent_id:'phy-1-2',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-1-2-3',name:'连接体问题',parent_id:'phy-1-2',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-1-3',name:'功和能',parent_id:'phy-1',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-1-4',name:'动量',parent_id:'phy-1',children:[],order:4,created_at:now,updated_at:now},
      {id:'phy-2',name:'电磁学',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-2-1',name:'静电场',parent_id:'phy-2',children:[],order:1,created_at:now,updated_at:now},
      {id:'phy-2-2',name:'恒定电流',parent_id:'phy-2',children:[],order:2,created_at:now,updated_at:now},
      {id:'phy-2-3',name:'磁场',parent_id:'phy-2',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-2-4',name:'电磁感应',parent_id:'phy-2',children:[],order:4,created_at:now,updated_at:now},
      {id:'phy-2-5',name:'交变电流',parent_id:'phy-2',children:[],order:5,created_at:now,updated_at:now},
      {id:'phy-3',name:'热学',children:[],order:3,created_at:now,updated_at:now},
      {id:'phy-4',name:'光学',children:[],order:4,created_at:now,updated_at:now},
      {id:'phy-5',name:'原子物理',children:[],order:5,created_at:now,updated_at:now},
      {id:'phy-6',name:'实验',children:[],order:6,created_at:now,updated_at:now},
    ];
    // 更新children数组
    this._rebuildKnowledgeChildren();
    this.syncTreeCache();
    this.saveData();
  }

  private _rebuildKnowledgeChildren(): void {
    for (const n of this.data.knowledgeTree) {
      n.children = this.data.knowledgeTree.filter(c => c.parent_id === n.id).map(c => c.id);
    }
    this.data.tags = upsertLegacyTreeTags(this.data.tags || [], this.data.knowledgeTree || [], 'knowledge', '\u7269\u7406');
  }

  createKnowledgeNode(node: Omit<KnowledgeNode, 'id' | 'created_at' | 'updated_at'>): KnowledgeNode {
    const now = new Date().toISOString();
    const newNode: KnowledgeNode = {
      ...node,
      id: 'kn-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
      created_at: now,
      updated_at: now
    };
    this.data.knowledgeTree.push(newNode);
    this._rebuildKnowledgeChildren();
    this.syncTreeCache();
    this.saveData();
    return newNode;
  }

  updateKnowledgeNode(id: string, updates: Partial<Omit<KnowledgeNode, 'id'>>): boolean {
    const idx = this.data.knowledgeTree.findIndex(n => n.id === id);
    if (idx === -1) return false;
    const oldName = this.data.knowledgeTree[idx].name;
    this.data.knowledgeTree[idx] = { ...this.data.knowledgeTree[idx], ...updates, updated_at: new Date().toISOString() };
    this._rebuildKnowledgeChildren();

    // If name changed, sync knowledge_point in questions referencing this node
    const newName = updates.name;
    if (newName !== undefined && newName !== oldName) {
      for (const q of this.data.questions) {
        if (q.knowledge_ids && q.knowledge_ids.includes(id)) {
          if (q.knowledge_point === oldName) {
            q.knowledge_point = newName;
          }
        }
      }
    }

    this.saveData();
    return true;
  }

  deleteKnowledgeNode(id: string): boolean {
    const idsToDelete = this.collectDescendantIds(id);
    if (idsToDelete.length === 0) return false;

    this.data.knowledgeTree = this.data.knowledgeTree.filter(n => !idsToDelete.includes(n.id));
    this.data.tags = (this.data.tags || []).filter(tag => !(tag.tag_type === 'knowledge' && idsToDelete.includes(tag.id)));
    this.data.questionTagRels = (this.data.questionTagRels || []).filter(rel => !(rel.tag_type === 'knowledge' && idsToDelete.includes(rel.tag_id)));

    // Clean up question references: remove deleted knowledge IDs from all questions
    for (const q of this.data.questions) {
      if (q.knowledge_ids && q.knowledge_ids.length > 0) {
        q.knowledge_ids = q.knowledge_ids.filter(kid => !idsToDelete.includes(kid));
      }
    }
    this.syncAllQuestionLegacyTagFields();

    this._rebuildKnowledgeChildren();
    this.syncTreeCache();
    this.saveData();
    return true;
  }

  private collectDescendantIds(id: string): string[] {
    const result: string[] = [id];
    const children = this.data.knowledgeTree.filter(n => n.parent_id === id);
    for (const child of children) {
      const childIds = this.collectDescendantIds(child.id);
      result.push(...childIds);
    }
    return result;
  }

  getKnowledgeChildren(parentId: string): KnowledgeNode[] {
    return this.getKnowledgeTree().filter(n => n.parent_id === parentId).sort((a, b) => a.order - b.order);
  }

  // ========== 模型树管理 ==========

  getModelTree(): KnowledgeNode[] {
    return tagsToLegacyTree(this.data.tags || [], 'model', this.data.modelTree || []);
  }

  initDefaultModelTree(): void {
    if (!this.data.taxonomySystems.some(system => system.id === 'model')) return;
    if ((this.data.modelTree || []).length > 0) return;
    const now = new Date().toISOString();
    this.data.modelTree = [
      { id: 'model-1', name: '运动模型', children: [], order: 1, created_at: now, updated_at: now },
      { id: 'model-1-1', name: '匀变速直线运动模型', parent_id: 'model-1', children: [], order: 1, created_at: now, updated_at: now },
      { id: 'model-1-2', name: '平抛运动模型', parent_id: 'model-1', children: [], order: 2, created_at: now, updated_at: now },
      { id: 'model-2', name: '受力模型', children: [], order: 2, created_at: now, updated_at: now },
      { id: 'model-2-1', name: '连接体模型', parent_id: 'model-2', children: [], order: 1, created_at: now, updated_at: now },
      { id: 'model-2-2', name: '临界极值模型', parent_id: 'model-2', children: [], order: 2, created_at: now, updated_at: now },
      { id: 'model-3', name: '能量模型', children: [], order: 3, created_at: now, updated_at: now },
      { id: 'model-4', name: '电磁模型', children: [], order: 4, created_at: now, updated_at: now },
    ];
    this._rebuildModelChildren();
    this.syncTreeCache();
    this.saveData();
  }

  private _rebuildModelChildren(): void {
    this.data.modelTree = this.data.modelTree || [];
    for (const n of this.data.modelTree) {
      n.children = this.data.modelTree.filter(c => c.parent_id === n.id).map(c => c.id);
    }
    this.data.tags = upsertLegacyTreeTags(this.data.tags || [], this.data.modelTree || [], 'model', '\u7269\u7406');
  }

  createModelNode(node: Omit<KnowledgeNode, 'id' | 'created_at' | 'updated_at'>): KnowledgeNode {
    const now = new Date().toISOString();
    const newNode: KnowledgeNode = {
      ...node,
      id: 'model-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
      created_at: now,
      updated_at: now,
    };
    this.data.modelTree = this.data.modelTree || [];
    this.data.modelTree.push(newNode);
    this._rebuildModelChildren();
    this.syncTreeCache();
    this.saveData();
    return newNode;
  }

  updateModelNode(id: string, updates: Partial<Omit<KnowledgeNode, 'id'>>): boolean {
    this.data.modelTree = this.data.modelTree || [];
    const idx = this.data.modelTree.findIndex(n => n.id === id);
    if (idx === -1) return false;
    const oldName = this.data.modelTree[idx].name;
    this.data.modelTree[idx] = { ...this.data.modelTree[idx], ...updates, updated_at: new Date().toISOString() };
    this._rebuildModelChildren();
    const newName = updates.name;
    if (newName !== undefined && newName !== oldName) {
      for (const q of this.data.questions) {
        if (q.model_ids && q.model_ids.includes(id) && q.model_point === oldName) {
          q.model_point = newName;
        }
      }
    }
    this.syncTreeCache();
    this.saveData();
    return true;
  }

  deleteModelNode(id: string): boolean {
    const idsToDelete = this.collectModelDescendantIds(id);
    if (idsToDelete.length === 0) return false;
    this.data.modelTree = (this.data.modelTree || []).filter(n => !idsToDelete.includes(n.id));
    this.data.tags = (this.data.tags || []).filter(tag => !(tag.tag_type === 'model' && idsToDelete.includes(tag.id)));
    this.data.questionTagRels = (this.data.questionTagRels || []).filter(rel => !(rel.tag_type === 'model' && idsToDelete.includes(rel.tag_id)));
    for (const q of this.data.questions) {
      if (q.model_ids && q.model_ids.length > 0) {
        q.model_ids = q.model_ids.filter(mid => !idsToDelete.includes(mid));
        const primary = q.model_ids.length > 0 ? this.getModelTree().find(node => node.id === q.model_ids![0]) : null;
        q.model_point = primary?.name || '';
      }
    }
    this.syncAllQuestionLegacyTagFields();
    this._rebuildModelChildren();
    this.syncTreeCache();
    this.saveData();
    return true;
  }

  private collectModelDescendantIds(id: string): string[] {
    const result: string[] = [id];
    const children = (this.data.modelTree || []).filter(n => n.parent_id === id);
    for (const child of children) {
      result.push(...this.collectModelDescendantIds(child.id));
    }
    return result;
  }

  setQuestionModelPoints(questionId: string, modelIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    const modelTree = this.getModelTree();
    const validIds = new Set(modelTree.map(node => node.id));
    const nextIds = [...new Set((modelIds || []).filter(id => validIds.has(id)))];
    const primary = nextIds.length > 0 ? modelTree.find(node => node.id === nextIds[0]) : null;
    question.model_ids = nextIds;
    question.model_point = primary?.name || '';
    question.updated_at = new Date().toISOString();
    this.replaceQuestionTagRels(questionId, 'model', nextIds);
    this.recordAuthorityDraft('questions', 'update', questionId, question);
    this.syncQuestionLocalRecord(question);
    this.saveData();
    return question;
  }

  addQuestionModelPoints(questionId: string, modelIds: string[]): Question | null {
    const question = this.data.questions.find(q => q.id === questionId);
    if (!question) return null;
    return this.setQuestionModelPoints(questionId, [...(question.model_ids || []), ...(modelIds || [])]);
  }
}

export default new BrowserDatabaseService();
