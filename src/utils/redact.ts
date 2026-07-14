/**
 * Heuristic redaction for tool logs / UI / model-facing tool results.
 * Not a complete secret scanner.
 */

const REDACTED = '[REDACTED]'

export function redactSecrets(text: string): string {
  if (!text) return text
  let result = text

  result = result.replace(
    /\b([A-Za-z][A-Za-z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|ACCESS[_-]?KEY|PRIVATE[_-]?KEY))\s*[=:]\s*["']?[^\s"'\\]+["']?/gi,
    (_match, name: string) => `${name}=${REDACTED}`
  )
  result = result.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`)
  result = result.replace(
    /\bauthorization\s*[=:]\s*["']?[^\s"']{8,}["']?/gi,
    `authorization=${REDACTED}`
  )
  result = result.replace(/\bsk-[A-Za-z0-9]{10,}\b/g, REDACTED)
  result = result.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, REDACTED)
  result = result.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED)
  result = result.replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED)

  return result
}

export function redactSecretsInArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (/(?:api[_-]?key|secret|token|password|passwd|authorization)/i.test(key) && typeof value === 'string') {
      out[key] = REDACTED
      continue
    }
    if (typeof value === 'string') {
      out[key] = redactSecrets(value)
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'string'
          ? redactSecrets(item)
          : item && typeof item === 'object'
            ? redactSecretsInArgs(item as Record<string, unknown>)
            : item
      )
    } else if (value && typeof value === 'object') {
      out[key] = redactSecretsInArgs(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}
