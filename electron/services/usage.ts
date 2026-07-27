import { BrowserWindow, app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { UsageSnapshot } from '../../src/types'
import {
  getUsagePeriodEnd,
  getUsagePeriodStart,
  normalizeUsageResetDay,
  type ChatCompletionUsage
} from '../../src/utils/usage-period'
import { getSettings } from './settings'

interface StoredUsage {
  periodStart: string
  requestCount: number
  promptTokens: number
  completionTokens: number
  usageMissingCount: number
  updatedAt: string
}

function getUsagePath(): string {
  return join(app.getPath('userData'), 'usage.json')
}

function emptyStored(periodStart: string): StoredUsage {
  return {
    periodStart,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    usageMissingCount: 0,
    updatedAt: new Date().toISOString()
  }
}

function toSnapshot(stored: StoredUsage): UsageSnapshot {
  return {
    periodStart: stored.periodStart,
    periodEnd: getUsagePeriodEnd(stored.periodStart),
    requestCount: stored.requestCount,
    promptTokens: stored.promptTokens,
    completionTokens: stored.completionTokens,
    usageMissingCount: stored.usageMissingCount,
    updatedAt: stored.updatedAt
  }
}

async function readStored(): Promise<StoredUsage | null> {
  try {
    const raw = await readFile(getUsagePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<StoredUsage>
    if (typeof parsed.periodStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.periodStart)) {
      return null
    }
    return {
      periodStart: parsed.periodStart,
      requestCount: Number.isFinite(parsed.requestCount) ? Math.max(0, Math.floor(parsed.requestCount!)) : 0,
      promptTokens: Number.isFinite(parsed.promptTokens) ? Math.max(0, Math.floor(parsed.promptTokens!)) : 0,
      completionTokens: Number.isFinite(parsed.completionTokens)
        ? Math.max(0, Math.floor(parsed.completionTokens!))
        : 0,
      usageMissingCount: Number.isFinite(parsed.usageMissingCount)
        ? Math.max(0, Math.floor(parsed.usageMissingCount!))
        : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    }
  } catch {
    return null
  }
}

async function writeStored(stored: StoredUsage): Promise<void> {
  const userDataPath = app.getPath('userData')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(getUsagePath(), JSON.stringify(stored, null, 2), 'utf-8')
}

function broadcast(snapshot: UsageSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('usage:updated', snapshot)
  }
}

async function resolvePeriodStart(now = new Date()): Promise<string> {
  const settings = await getSettings()
  return getUsagePeriodStart(now, normalizeUsageResetDay(settings.usageResetDay))
}

/** Ensure stored row matches the current period; roll over if needed. */
async function loadForCurrentPeriod(): Promise<StoredUsage> {
  const periodStart = await resolvePeriodStart()
  const stored = await readStored()
  if (!stored || stored.periodStart !== periodStart) {
    return emptyStored(periodStart)
  }
  return stored
}

export async function getUsage(): Promise<UsageSnapshot> {
  const stored = await loadForCurrentPeriod()
  // Persist rollover so StatusBar / Settings stay consistent after period change
  const previous = await readStored()
  if (!previous || previous.periodStart !== stored.periodStart) {
    await writeStored(stored)
  }
  return toSnapshot(stored)
}

export async function resetUsage(): Promise<UsageSnapshot> {
  const periodStart = await resolvePeriodStart()
  const stored = emptyStored(periodStart)
  await writeStored(stored)
  const snapshot = toSnapshot(stored)
  broadcast(snapshot)
  return snapshot
}

/**
 * Record one successful chat/completions call.
 * Pass `usage` when the API returned tokens; omit / null → usageMissingCount++.
 */
export async function recordChatCompletionUsage(
  usage: ChatCompletionUsage | null
): Promise<UsageSnapshot> {
  const stored = await loadForCurrentPeriod()
  stored.requestCount += 1
  if (usage) {
    stored.promptTokens += usage.promptTokens
    stored.completionTokens += usage.completionTokens
  } else {
    stored.usageMissingCount += 1
  }
  stored.updatedAt = new Date().toISOString()
  await writeStored(stored)
  const snapshot = toSnapshot(stored)
  broadcast(snapshot)
  return snapshot
}

/** Fire-and-forget wrapper so AI paths never block on usage I/O. */
export function recordChatCompletionUsageFireAndForget(
  usage: ChatCompletionUsage | null
): void {
  void recordChatCompletionUsage(usage).catch(() => {
    // usage tracking must not break AI
  })
}
