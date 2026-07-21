function matchesEveryIncludeGroup(values, groups = []) {
  const active = groups.filter(group => Array.isArray(group) && group.length > 0);
  return active.length === 0 || active.every(group => group.some(id => values.includes(id)));
}

export function matchesTaxonomyFilters(taxonomyIds = {}, filters = {}) {
  for (const [systemId, filter] of Object.entries(filters || {})) {
    const values = Array.isArray(taxonomyIds?.[systemId]) ? taxonomyIds[systemId].map(String) : [];
    if (!matchesEveryIncludeGroup(values, filter?.includeGroups || [])) return false;
    const excluded = new Set((filter?.excludeIds || []).map(String));
    if (values.some(id => excluded.has(id))) return false;
  }
  return true;
}
