import type { KnowledgeNode } from '../types';

export type AutoTagMatch = {
  tagId: string;
  tagName: string;
  tagType: 'knowledge' | 'model';
  keyword: string;
};

export type AutoTagConfig = {
  knowledgeKeywords?: Record<string, string[]>;
  modelKeywords?: Record<string, string[]>;
};

const DEFAULT_KEYWORDS: AutoTagConfig = {
  knowledgeKeywords: {
    '牛顿第二定律': ['牛顿第二定律', 'F=ma', '加速度与合外力'],
    '运动学': ['运动学', '匀变速', '位移', '速度', '加速度'],
    '电磁感应': ['电磁感应', '感应电动势', '楞次定律'],
  },
  modelKeywords: {
    '过程模型': ['过程分析', '阶段', '全过程'],
    '图像模型': ['图像', 'v-t', 'x-t', 'a-t'],
    '受力分析模型': ['受力分析', '合力', '平衡'],
    '传送带模型': ['传送带', '皮带'],
  },
};

function normalizeText(value: unknown): string {
  return String(value || '').toLowerCase();
}

function questionText(question: any): string {
  return [
    question.stem,
    question.content,
    question.answer,
    question.analysis,
    question.explanation,
    ...(Array.isArray(question.options) ? question.options.map((item: any) => `${item?.label || ''} ${item?.content || item}`) : []),
  ].map(normalizeText).join('\n');
}

function matchNodeByKeywords(
  text: string,
  node: KnowledgeNode,
  tagType: 'knowledge' | 'model',
  keywordConfig: Record<string, string[]> = {}
): AutoTagMatch[] {
  const keywords = [node.name, ...(keywordConfig[node.name] || [])]
    .map(item => item.trim())
    .filter(Boolean);
  const matched = keywords.find(keyword => text.includes(keyword.toLowerCase()));
  if (!matched) return [];
  return [{ tagId: node.id, tagName: node.name, tagType, keyword: matched }];
}

export function recommendTagsForQuestion(
  question: any,
  knowledgeNodes: KnowledgeNode[],
  modelNodes: KnowledgeNode[],
  config: AutoTagConfig = DEFAULT_KEYWORDS
): AutoTagMatch[] {
  const text = questionText(question);
  const matches = [
    ...knowledgeNodes.flatMap(node => matchNodeByKeywords(text, node, 'knowledge', config.knowledgeKeywords)),
    ...modelNodes.flatMap(node => matchNodeByKeywords(text, node, 'model', config.modelKeywords)),
  ];
  const seen = new Set<string>();
  return matches.filter(match => {
    const key = `${match.tagType}:${match.tagId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyAutoTagsToQuestion(
  question: any,
  knowledgeNodes: KnowledgeNode[],
  modelNodes: KnowledgeNode[],
  config?: AutoTagConfig
): any {
  const matches = recommendTagsForQuestion(question, knowledgeNodes, modelNodes, config);
  const knowledgeIds = matches.filter(match => match.tagType === 'knowledge').map(match => match.tagId);
  const modelIds = matches.filter(match => match.tagType === 'model').map(match => match.tagId);
  const knowledgeNames = matches.filter(match => match.tagType === 'knowledge').map(match => match.tagName);
  const modelNames = matches.filter(match => match.tagType === 'model').map(match => match.tagName);

  return {
    ...question,
    knowledge_ids: [...new Set([...(question.knowledge_ids || question.knowledge_point_ids || []), ...knowledgeIds])],
    knowledge_point_ids: [...new Set([...(question.knowledge_point_ids || question.knowledge_ids || []), ...knowledgeIds])],
    knowledge_points: [...new Set([...(question.knowledge_points || []), ...knowledgeNames])],
    knowledge_point: question.knowledge_point || knowledgeNames[0] || '',
    model_ids: [...new Set([...(question.model_ids || question.model_point_ids || []), ...modelIds])],
    model_point_ids: [...new Set([...(question.model_point_ids || question.model_ids || []), ...modelIds])],
    model_points: [...new Set([...(question.model_points || []), ...modelNames])],
    model_point: question.model_point || modelNames[0] || '',
    autoTagMatches: matches,
  };
}
