import type { KnowledgeNode, Question } from '../types';

const DB_NAME = 'question_local_store_v1';
const DB_VERSION = 1;
const META_STORE = 'question_meta';
const CONTENT_STORE = 'question_content';
const TREE_STORE = 'tree_cache';

type TreeKind = 'knowledge' | 'model';

type QuestionMeta = {
  id: string;
  subject?: string;
  type?: string;
  status?: string;
  edit_status?: string;
  difficulty?: number;
  year?: string;
  grade?: string;
  semester?: string;
  exam_type?: string;
  source?: string;
  region?: string;
  school?: string;
  knowledge_ids?: string[];
  model_ids?: string[];
  knowledge_point?: string;
  model_point?: string;
  created_at?: string;
  updated_at?: string;
  deleted?: boolean;
  deleted_at?: string;
  has_image?: boolean;
  has_formula?: boolean;
  fingerprint?: string;
  search_text?: string;
};

type QuestionContent = {
  id: string;
  payload: Question;
};

export type QuestionPageQuery = {
  page: number;
  pageSize: number;
  subjectIds?: string[];
  types?: string[];
  examTypes?: string[];
  statuses?: string[];
  grades?: string[];
  semesters?: string[];
  difficulties?: string[];
  year?: string;
  basketIds?: string[];
  basketOnly?: boolean;
  source?: string;
  searchTerms?: string[];
  includeKnowledgeGroups?: string[][];
  excludeKnowledgeIds?: string[];
  includeModelGroups?: string[][];
  pendingEditOnly?: boolean;
  dedupe?: boolean;
};

let dbPromise: Promise<IDBDatabase> | null = null;
let seedPromise: Promise<void> | null = null;
const fallbackMeta = new Map<string, QuestionMeta>();
const fallbackContent = new Map<string, Question>();
const fallbackTrees: Record<TreeKind, KnowledgeNode[]> = { knowledge: [], model: [] };

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        const store = db.createObjectStore(META_STORE, { keyPath: 'id' });
        store.createIndex('updated_at', 'updated_at');
        store.createIndex('subject', 'subject');
        store.createIndex('type', 'type');
        store.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(CONTENT_STORE)) {
        db.createObjectStore(CONTENT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TREE_STORE)) {
        db.createObjectStore(TREE_STORE, { keyPath: 'kind' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function stripHtml(value: any): string {
  return String(value || '')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*?\$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArray(value: any): string[] {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function difficultyBucket(difficulty?: number): string {
  const value = Number(difficulty || 1);
  if (value <= 2) return '简单';
  if (value === 3) return '中等';
  return '较难';
}

function isPendingEdit(question: QuestionMeta): boolean {
  const status = String(question.edit_status || '未编辑').trim().toLowerCase();
  return !['已编辑', 'edited', 'done', 'completed'].includes(status);
}

function buildMeta(question: Question): QuestionMeta {
  const content = (question as any).content ?? (question as any).stem ?? '';
  const searchText = [
    content,
    (question as any).answer,
    (question as any).analysis,
    (question as any).explanation,
    (question as any).source,
    (question as any).exam_type,
    (question as any).region,
    (question as any).school,
    (question as any).year,
    ...normalizeArray((question as any).options),
    ...normalizeArray((question as any).knowledge_ids ?? (question as any).knowledge_point_ids),
    ...normalizeArray((question as any).model_ids ?? (question as any).model_point_ids),
  ].map(stripHtml).filter(Boolean).join('\n').toLowerCase();

  return {
    id: question.id,
    subject: (question as any).subject,
    type: (question as any).type,
    status: (question as any).status,
    edit_status: (question as any).edit_status,
    difficulty: Number((question as any).difficulty || 1),
    year: (question as any).year,
    grade: (question as any).grade,
    semester: (question as any).semester,
    exam_type: (question as any).exam_type,
    source: (question as any).source,
    region: (question as any).region,
    school: (question as any).school,
    knowledge_ids: normalizeArray((question as any).knowledge_ids ?? (question as any).knowledge_point_ids),
    model_ids: normalizeArray((question as any).model_ids ?? (question as any).model_point_ids),
    knowledge_point: (question as any).knowledge_point,
    model_point: (question as any).model_point,
    created_at: (question as any).created_at,
    updated_at: (question as any).updated_at,
    deleted: Boolean((question as any).deleted),
    deleted_at: (question as any).deleted_at,
    has_image: Boolean((question as any).has_image),
    has_formula: Boolean((question as any).has_formula),
    fingerprint: stripHtml(content).replace(/\s+/g, ''),
    search_text: searchText,
  };
}

function matchesList(value: any, selected?: string[]): boolean {
  const active = (selected || []).filter(item => item && item !== '全部');
  return active.length === 0 || active.includes(String(value || ''));
}

function matchesAnyGroup(values: string[], groups?: string[][]): boolean {
  const active = (groups || []).filter(group => group.length > 0);
  return active.length === 0 || active.every(group => group.some(id => values.includes(id)));
}

function matchesQuery(meta: QuestionMeta, query: QuestionPageQuery): boolean {
  if (meta.deleted) return false;
  if (query.pendingEditOnly && !isPendingEdit(meta)) return false;
  if (query.subjectIds?.length && !query.subjectIds.includes(meta.subject || '')) return false;
  if (!matchesList(meta.type, query.types)) return false;
  if (!matchesList(meta.exam_type || '其他', query.examTypes)) return false;
  if (!matchesList(meta.status || 'draft', query.statuses)) return false;
  if (!matchesList(meta.grade, query.grades)) return false;
  if (!matchesList(meta.semester, query.semesters)) return false;
  if (!matchesList(difficultyBucket(meta.difficulty), query.difficulties)) return false;
  if (query.year && query.year !== '全部' && meta.year !== query.year) return false;
  if (query.basketOnly && !(query.basketIds || []).includes(meta.id)) return false;
  if (query.source?.trim()) {
    const source = [meta.source, meta.region, meta.school, meta.exam_type, meta.year].filter(Boolean).join(' ').toLowerCase();
    if (!source.includes(query.source.trim().toLowerCase())) return false;
  }
  const searchTerms = (query.searchTerms || []).map(term => term.trim().toLowerCase()).filter(Boolean);
  if (searchTerms.length > 0 && !searchTerms.every(term => (meta.search_text || '').includes(term))) return false;
  const knowledgeIds = normalizeArray(meta.knowledge_ids);
  if (!matchesAnyGroup(knowledgeIds, query.includeKnowledgeGroups)) return false;
  const exclude = new Set(query.excludeKnowledgeIds || []);
  if (exclude.size > 0 && knowledgeIds.some(id => exclude.has(id))) return false;
  const modelIds = normalizeArray(meta.model_ids);
  if (!matchesAnyGroup(modelIds, query.includeModelGroups)) return false;
  return true;
}

export async function upsertQuestionLocalRecord(question: Question): Promise<void> {
  if (!question?.id) return;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (_err) {
    fallbackMeta.set(question.id, buildMeta(question));
    fallbackContent.set(question.id, question);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, CONTENT_STORE], 'readwrite');
    tx.objectStore(META_STORE).put(buildMeta(question));
    tx.objectStore(CONTENT_STORE).put({ id: question.id, payload: question } satisfies QuestionContent);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeQuestionLocalRecord(id: string): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (_err) {
    fallbackMeta.delete(id);
    fallbackContent.delete(id);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, CONTENT_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(CONTENT_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function seedQuestionLocalStore(questions: Question[]): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (_err) {
    for (const question of questions || []) {
      if (!question?.id) continue;
      fallbackMeta.set(question.id, buildMeta(question));
      fallbackContent.set(question.id, question);
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, CONTENT_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    const contentStore = tx.objectStore(CONTENT_STORE);
    for (const question of questions || []) {
      if (!question?.id) continue;
      metaStore.put(buildMeta(question));
      contentStore.put({ id: question.id, payload: question } satisfies QuestionContent);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function reconcileQuestionLocalStore(questions: Question[]): Promise<void> {
  const rows = (questions || []).filter(question => question?.id);
  if (rows.length === 0) return;
  await seedQuestionLocalStore(rows);
}

export async function ensureQuestionLocalStoreSeeded(loadQuestions: () => Question[]): Promise<void> {
  if (seedPromise) await seedPromise;
  seedPromise = (async () => {
    const sourceQuestions = loadQuestions();
    let count = fallbackMeta.size;
    try {
      const db = await openDb();
      count = await requestToPromise(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).count());
    } catch (_err) {
      count = fallbackMeta.size;
    }
    if (count === 0 || sourceQuestions.length > count) {
      await seedQuestionLocalStore(sourceQuestions);
    }
  })();
  try {
    await seedPromise;
  } finally {
    seedPromise = null;
  }
}

export async function cacheQuestionTrees(knowledgeTree: KnowledgeNode[], modelTree: KnowledgeNode[]): Promise<void> {
  fallbackTrees.knowledge = knowledgeTree || [];
  fallbackTrees.model = modelTree || [];
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (_err) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TREE_STORE, 'readwrite');
    tx.objectStore(TREE_STORE).put({ kind: 'knowledge', nodes: knowledgeTree || [], updatedAt: new Date().toISOString() });
    tx.objectStore(TREE_STORE).put({ kind: 'model', nodes: modelTree || [], updatedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedQuestionTree(kind: TreeKind): Promise<KnowledgeNode[]> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (_err) {
    return fallbackTrees[kind] || [];
  }
  const row: any = await requestToPromise(db.transaction(TREE_STORE, 'readonly').objectStore(TREE_STORE).get(kind));
  return Array.isArray(row?.nodes) ? row.nodes : [];
}

export async function queryQuestionPage(query: QuestionPageQuery): Promise<{ total: number; rows: Question[]; metaRows: QuestionMeta[] }> {
  let db: IDBDatabase | null = null;
  let metas: QuestionMeta[];
  try {
    db = await openDb();
    metas = await requestToPromise(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll());
  } catch (_err) {
    metas = [...fallbackMeta.values()];
  }
  let filtered = metas
    .filter(meta => matchesQuery(meta, query))
    .sort((a, b) => String(b.created_at || b.updated_at || '').localeCompare(String(a.created_at || a.updated_at || '')));

  if (query.dedupe) {
    const seen = new Set<string>();
    filtered = filtered.filter(meta => {
      const key = meta.fingerprint || meta.id;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const total = filtered.length;
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.max(1, query.pageSize || 10);
  const pageMetas = filtered.slice((page - 1) * pageSize, page * pageSize);
  let rows: Question[];
  if (db) {
    const contentStore = db.transaction(CONTENT_STORE, 'readonly').objectStore(CONTENT_STORE);
    rows = await Promise.all(pageMetas.map(async meta => {
      const content = await requestToPromise<QuestionContent | undefined>(contentStore.get(meta.id));
      return { ...(meta as any), ...(content?.payload || {}) } as Question;
    }));
  } else {
    rows = pageMetas.map(meta => ({ ...(meta as any), ...(fallbackContent.get(meta.id) || {}) } as Question));
  }
  return { total, rows, metaRows: pageMetas };
}
