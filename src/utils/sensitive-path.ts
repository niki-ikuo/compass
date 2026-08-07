/** Sensitive relative/absolute paths that should not auto-apply or be sent to the LLM. */
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.env($|\.|\/)/i,
  /(^|\/)\.env\.[^/]+$/i,
  /\.(pem|key|p12|pfx|jks)$/i,
  /(^|\/)id_rsa$/i,
  /(^|\/)id_dsa$/i,
  /(^|\/)id_ecdsa$/i,
  /(^|\/)id_ed25519$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)credentials(\.json)?$/i,
  /(^|\/)secrets?\./i,
  /(^|\/)\.compass\/settings\.json$/i,
  /(^|\/)(?:\.git-credentials|netrc|\.netrc)$/i
]

export function isSensitivePath(relativeOrAbsolutePath: string): boolean {
  const normalized = relativeOrAbsolutePath.replace(/\\/g, '/')
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(normalized))
}
