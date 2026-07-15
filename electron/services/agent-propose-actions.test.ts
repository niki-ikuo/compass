import { describe, expect, it } from 'vitest'
import {
  coerceProposeActionsArgs,
  parseToolArgs,
  tryParseJsonValue
} from './agent-propose-actions'

describe('coerceProposeActionsArgs', () => {
  it('passes through a valid actions array', () => {
    const args = {
      actions: [{ type: 'writeFile', path: 'a.ts', content: 'x' }]
    }
    expect(coerceProposeActionsArgs(args)).toBe(args)
  })

  it('recovers actions from a stringified JSON array', () => {
    const actions = [{ type: 'mkdir', path: 'src/new' }]
    const result = coerceProposeActionsArgs({
      actions: JSON.stringify(actions)
    })
    expect(result.actions).toEqual(actions)
  })

  it('recovers from double-encoded JSON', () => {
    const actions = [{ type: 'writeFile', path: 'b.ts', content: 'hi' }]
    const result = coerceProposeActionsArgs({
      actions: JSON.stringify(JSON.stringify(actions))
    })
    expect(result.actions).toEqual(actions)
  })

  it('recovers from markdown fenced JSON in _raw', () => {
    const actions = [{ type: 'deleteFile', path: 'old.txt' }]
    const result = coerceProposeActionsArgs({
      _raw: `Here you go:\n\`\`\`json\n${JSON.stringify({ actions })}\n\`\`\``
    })
    expect(result.actions).toEqual(actions)
  })

  it('recovers from a blob value containing writeFile JSON', () => {
    const actions = [{ type: 'writeFile', path: 'c.ts', content: 'z' }]
    const result = coerceProposeActionsArgs({
      weird: `payload ${JSON.stringify({ actions })}`
    })
    expect(result.actions).toEqual(actions)
  })

  it('leaves unrecoverable args unchanged', () => {
    const args = { actions: 'not-json' }
    expect(coerceProposeActionsArgs(args)).toEqual(args)
  })
})

describe('parseToolArgs / tryParseJsonValue', () => {
  it('parses object tool arguments', () => {
    expect(parseToolArgs('{"path":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
  })

  it('stores invalid JSON as _raw', () => {
    expect(parseToolArgs('{not json')).toEqual({ _raw: '{not json' })
  })

  it('extracts JSON object from surrounding text', () => {
    expect(tryParseJsonValue('prefix {"a":1} suffix')).toEqual({ a: 1 })
  })

  it('returns undefined for empty input', () => {
    expect(tryParseJsonValue('')).toBeUndefined()
    expect(parseToolArgs('')).toEqual({})
  })
})
