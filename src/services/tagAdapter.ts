import { KnowledgeNode, Question, QuestionTagRel, Tag, TagType } from '../types';

export function makeQuestionTagRelId(questionId: string, tagId: string, tagType: TagType): string {
  return `${questionId}__${tagType}__${tagId}`;
}

export function legacyNodeToTag(node: KnowledgeNode, tagType: TagType, subject?: string): Tag {
  return {
    id: node.id,
    tag_type: tagType,
    tag_name: node.name,
    tag_code: node.id,
    parent_id: node.parent_id,
    subject,
    sort_no: node.order || 0,
    status: 1,
    created_at: node.created_at,
    updated_at: node.updated_at,
  };
}

export function tagToLegacyNode(tag: Tag, allTags: Tag[]): KnowledgeNode {
  return {
    id: tag.id,
    name: tag.tag_name,
    parent_id: tag.parent_id,
    children: allTags
      .filter(child => child.tag_type === tag.tag_type && child.parent_id === tag.id && child.status !== 0)
      .sort(sortTags)
      .map(child => child.id),
    order: tag.sort_no || 0,
    created_at: tag.created_at,
    updated_at: tag.updated_at,
  };
}

export function tagsToLegacyTree(tags: Tag[], tagType: TagType, fallback: KnowledgeNode[] = []): KnowledgeNode[] {
  const activeTags = tags.filter(tag => tag.tag_type === tagType && tag.status !== 0).sort(sortTags);
  if (activeTags.length === 0) return fallback;
  return activeTags.map(tag => tagToLegacyNode(tag, activeTags));
}

export function upsertLegacyTreeTags(tags: Tag[], nodes: KnowledgeNode[], tagType: TagType, subject?: string): Tag[] {
  const next = [...(tags || [])];
  for (const node of nodes || []) {
    const tag = legacyNodeToTag(node, tagType, subject);
    const index = next.findIndex(item => item.id === tag.id && item.tag_type === tagType);
    if (index === -1) {
      next.push(tag);
    } else {
      next[index] = { ...next[index], ...tag };
    }
  }
  return dedupeTags(next);
}

export function normalizeQuestionTagRels(rels: QuestionTagRel[]): QuestionTagRel[] {
  const seen = new Set<string>();
  const next: QuestionTagRel[] = [];
  for (const rel of rels || []) {
    if (!rel?.question_id || !rel?.tag_id || !rel?.tag_type) continue;
    const key = `${rel.question_id}__${rel.tag_type}__${rel.tag_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({
      ...rel,
      id: rel.id || makeQuestionTagRelId(rel.question_id, rel.tag_id, rel.tag_type),
      created_at: rel.created_at || new Date().toISOString(),
    });
  }
  return next;
}

export function relsFromQuestionLegacyIds(question: Question, tagType: TagType): QuestionTagRel[] {
  const ids = tagType === 'knowledge'
    ? [...(question.knowledge_ids || []), ...(question.knowledge_point_ids || [])]
    : tagType === 'model'
      ? [...(question.model_ids || []), ...(question.model_point_ids || [])]
      : [];
  const now = new Date().toISOString();
  return [...new Set(ids)].filter(Boolean).map(tagId => ({
    id: makeQuestionTagRelId(question.id, tagId, tagType),
    question_id: question.id,
    tag_id: tagId,
    tag_type: tagType,
    created_at: now,
  }));
}

function dedupeTags(tags: Tag[]): Tag[] {
  const seen = new Set<string>();
  const next: Tag[] = [];
  for (const tag of tags || []) {
    if (!tag?.id || !tag?.tag_type) continue;
    const key = `${tag.tag_type}__${tag.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(tag);
  }
  return next;
}

function sortTags(a: Tag, b: Tag): number {
  return (a.sort_no || 0) - (b.sort_no || 0) || a.tag_name.localeCompare(b.tag_name);
}
