type LayoutRow = { uid: string; question: { id: string; type: string }; sectionTitle: string; score: number };
export function restorePaperLayout<T extends LayoutRow>(rows: T[], draft: any): T[] {
  const remaining = new Map(rows.map(row => [row.question.id, row]));
  const result: T[] = [];
  for (const saved of Array.isArray(draft?.items) ? draft.items : []) {
    const current = remaining.get(saved.id);
    if (!current) continue;
    result.push({ ...current, sectionTitle: typeof saved.sectionTitle === 'string' && saved.sectionTitle.trim() ? saved.sectionTitle : current.sectionTitle,
      score: typeof saved.score === 'number' && Number.isFinite(saved.score) && saved.score >= 0 ? saved.score : current.score });
    remaining.delete(saved.id);
  }
  return [...result, ...remaining.values()];
}

export function groupPaperItems<T extends LayoutRow>(rows: T[], sections: Record<string, string>): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const sectionTitle = sections[row.question.type] || '综合题';
    if (!groups.has(sectionTitle)) groups.set(sectionTitle, []);
    groups.get(sectionTitle)!.push({ ...row, sectionTitle });
  }
  return [...groups.values()].flat();
}
