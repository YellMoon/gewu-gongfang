'use strict';
const MODULE_COLLECTIONS = Object.freeze({ courses: ['courses', 'rooms'], schedules: ['schedules'] });

// Keep the original authorization CTEs and field expressions. Skip unrelated
// aggregates before querying, rather than downloading a full projection to filter.
function scopeProjectionSql(sql, module) {
  const collections = MODULE_COLLECTIONS[module];
  if (!Object.hasOwn(MODULE_COLLECTIONS, module)) throw new Error('DESKTOP_PROJECTION_MODULE_INVALID');
  const prefix = 'SELECT jsonb_build_object(';
  const offset = sql.indexOf(prefix);
  if (offset < 0) throw new Error('DESKTOP_PROJECTION_SQL_INVALID');
  const start = offset + prefix.length;
  const args = [];
  let depth = 0, quoted = false, part = start, end = -1;
  for (let i = start; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      if (quoted && sql[i + 1] === "'") { i++; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) { args.push(sql.slice(part, i)); end = i; break; }
        depth--;
      } else if (c === ',' && depth === 0) { args.push(sql.slice(part, i)); part = i + 1; }
    }
  }
  if (end < 0 || args.length % 2) throw new Error('DESKTOP_PROJECTION_SQL_INVALID');
  const selected = new Set(collections);
  for (let i = 0; i < args.length; i += 2) {
    const match = /^\s*'([A-Za-z_]+)'\s*$/.exec(args[i]);
    if (!match) throw new Error('DESKTOP_PROJECTION_SQL_INVALID');
    if (!selected.has(match[1])) args[i + 1] = "'[]'::jsonb";
  }
  return sql.slice(0, start) + args.join(',') + sql.slice(end);
}
module.exports = { MODULE_COLLECTIONS, scopeProjectionSql };
