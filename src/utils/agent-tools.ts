/** Main → Renderer の tools 非対応エラー識別用プレフィックス */
export const AGENT_TOOLS_UNSUPPORTED_PREFIX = 'TOOLS_UNSUPPORTED:'

export function formatAgentToolsUnsupportedError(message: string): string {
  return `${AGENT_TOOLS_UNSUPPORTED_PREFIX}${message}`
}

/** tools 非対応エラーならユーザー向け本文を返す。それ以外は null */
export function parseAgentToolsUnsupportedError(error: string): string | null {
  if (!error.startsWith(AGENT_TOOLS_UNSUPPORTED_PREFIX)) return null
  return error.slice(AGENT_TOOLS_UNSUPPORTED_PREFIX.length)
}
