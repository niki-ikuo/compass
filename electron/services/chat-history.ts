import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  normalizeChatMode,
  normalizeUseCasePreset,
  normalizeAgentSteps,
  type ChatMessage,
  type ChatSession
} from '../../src/types'

const COMPASS_DIR = '.compass'
const CHAT_HISTORY_FILE = 'chat-history.json'
const HISTORY_VERSION = 1

export interface WorkspaceChatHistory {
  version: number
  activeChatId: string | null
  sessions: ChatSession[]
}

function getChatHistoryPath(workspaceRoot: string): string {
  return join(workspaceRoot, COMPASS_DIR, CHAT_HISTORY_FILE)
}

function createDefaultHistory(): WorkspaceChatHistory {
  return { version: HISTORY_VERSION, activeChatId: null, sessions: [] }
}

function isValidSession(session: unknown): session is ChatSession {
  if (!session || typeof session !== 'object') return false
  const s = session as Partial<ChatSession>
  return (
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    Array.isArray(s.messages) &&
    Array.isArray(s.contextRefs) &&
    typeof s.createdAt === 'number' &&
    typeof s.updatedAt === 'number'
  )
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  const mode = normalizeChatMode(message.mode)
  const preset = normalizeUseCasePreset(message.preset)
  const agentSteps = normalizeAgentSteps(message.agentSteps)
  return {
    ...message,
    mode: mode || undefined,
    preset: preset || undefined,
    ...(agentSteps ? { agentSteps } : { agentSteps: undefined })
  }
}

function normalizeSession(session: ChatSession): ChatSession {
  return {
    ...session,
    isOpen: session.isOpen !== false,
    messages: session.messages.map(normalizeMessage)
  }
}

export async function loadChatHistory(workspaceRoot: string): Promise<WorkspaceChatHistory> {
  try {
    const raw = await readFile(getChatHistoryPath(workspaceRoot), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceChatHistory>
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.filter(isValidSession).map(normalizeSession)
      : []

    const openSessions = sessions.filter((s) => s.isOpen)
    const preferredActiveId =
      typeof parsed.activeChatId === 'string' &&
      openSessions.some((s) => s.id === parsed.activeChatId)
        ? parsed.activeChatId
        : openSessions[openSessions.length - 1]?.id ??
          sessions[sessions.length - 1]?.id ??
          null

    return {
      version: HISTORY_VERSION,
      activeChatId: preferredActiveId,
      sessions
    }
  } catch {
    return createDefaultHistory()
  }
}

export async function saveChatHistory(
  workspaceRoot: string,
  history: WorkspaceChatHistory
): Promise<void> {
  const compassDir = join(workspaceRoot, COMPASS_DIR)
  await mkdir(compassDir, { recursive: true })
  await writeFile(
    getChatHistoryPath(workspaceRoot),
    JSON.stringify({ ...history, version: HISTORY_VERSION }, null, 2),
    'utf-8'
  )
}
