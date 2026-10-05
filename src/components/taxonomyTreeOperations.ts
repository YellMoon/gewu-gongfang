import type { KnowledgeNode } from '../types';

export function filterTaxonomyNodes(nodes: KnowledgeNode[], query: string): KnowledgeNode[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return nodes;
  const visible = new Set<string>();
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    if (!node.name.toLocaleLowerCase().includes(term)) continue;
    visible.add(node.id);
    let parent = node.parent_id;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent); visible.add(parent); parent = byId.get(parent)?.parent_id;
    }
    const descendants = [node.id];
    while (descendants.length) {
      const id = descendants.pop();
      for (const child of nodes.filter(item => item.parent_id === id)) {
        if (!visible.has(child.id)) { visible.add(child.id); descendants.push(child.id); }
      }
    }
  }
  return nodes.filter(node => visible.has(node.id));
}

/** Return only changed rows. An empty parent explicitly clears an existing parent. */
export function planTaxonomyDrop(nodes: KnowledgeNode[], dragId: string, dropId: string, position: number, gap: boolean) {
  const drag = nodes.find(node => node.id === dragId);
  const drop = nodes.find(node => node.id === dropId);
  if (!drag || !drop || dragId === dropId) return [];
  let ancestor: KnowledgeNode | undefined = drop;
  const visited = new Set<string>();
  while (ancestor && !visited.has(ancestor.id)) {
    if (ancestor.id === dragId) throw new Error('不能将节点移动到自身或其子节点下');
    visited.add(ancestor.id); ancestor = nodes.find(node => node.id === ancestor?.parent_id);
  }
  const parentId = gap ? (drop.parent_id || '') : drop.id;
  const siblings = nodes.filter(node => (node.parent_id || '') === parentId && node.id !== dragId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const index = gap ? siblings.findIndex(node => node.id === dropId) + (position > 0 ? 1 : 0) : siblings.length;
  siblings.splice(index, 0, drag);
  return siblings.map((node, order) => ({ id: node.id, parent_id: parentId, order }))
    .filter(update => { const original = nodes.find(node => node.id === update.id)!; return (original.parent_id || '') !== update.parent_id || original.order !== update.order; });
}
