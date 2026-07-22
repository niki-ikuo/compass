/**
 * Guardrails for Agent SQL against the in-memory data sandbox.
 * Only single-statement read-only SELECT (or WITH … SELECT) is allowed.
 */

/** Statement-level writers / admin (avoid matching SQL functions like replace()). */
const FORBIDDEN_STATEMENT =
  /(?:^|[\s(;])(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRUNCATE|GRANT|REVOKE)\b(?!\s*\()/i

export function assertSelectOnlySql(sql: string): { ok: true; sql: string } | { ok: false; error: string } {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (!trimmed) {
    return { ok: false, error: 'sql must be a non-empty SELECT statement' }
  }
  if (trimmed.includes(';')) {
    return { ok: false, error: 'Only a single SQL statement is allowed' }
  }
  if (FORBIDDEN_STATEMENT.test(trimmed)) {
    return { ok: false, error: 'Only read-only SELECT queries are allowed (no DDL/DML)' }
  }
  if (!/^(WITH\b|SELECT\b)/i.test(trimmed)) {
    return { ok: false, error: 'Query must start with SELECT or WITH' }
  }
  if (/\bSELECT\b[\s\S]*\bINTO\b/i.test(trimmed)) {
    return { ok: false, error: 'SELECT INTO is not allowed' }
  }
  return { ok: true, sql: trimmed }
}
