/** CLI flag for headless scheduled job runs */
export const RUN_JOB_ARG_PREFIX = '--run-job='

/**
 * Parse `--run-job=<id>` or `--run-job <id>` from argv (main or second-instance).
 */
export function parseRunJobArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const entry = argv[i]
    if (!entry) continue
    if (entry.startsWith(RUN_JOB_ARG_PREFIX)) {
      const id = entry.slice(RUN_JOB_ARG_PREFIX.length).trim()
      return id || null
    }
    if (entry === '--run-job') {
      const next = argv[i + 1]?.trim()
      return next || null
    }
  }
  return null
}
