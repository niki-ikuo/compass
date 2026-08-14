import { describe, expect, it } from 'vitest'
import { runShipCheckStageA } from './desk-ship-check'
import { parseTermPairs } from './markdown-outline'

const OUTBOX = [
  '---',
  'kind: outbox',
  'preset: chat',
  'status: draft',
  'createdAt: 2026-01-01T00:00:00Z',
  '---',
  ''
].join('\n')

describe('runShipCheckStageA terms', () => {
  it('warns when an avoided form appears even if the preferred form is also present', () => {
    const result = runShipCheckStageA(`${OUTBOX}Use API Key and an apikey.\n`, {
      terms: parseTermPairs('API Key | apikey')
    })
    expect(result.findings.some((f) => f.id === 'term_mismatch')).toBe(true)
  })

  it('does not warn when only the preferred form appears', () => {
    const result = runShipCheckStageA(`${OUTBOX}Use an API Key.\n`, {
      terms: parseTermPairs('API Key | apikey')
    })
    expect(result.findings.some((f) => f.id === 'term_mismatch')).toBe(false)
  })
})
