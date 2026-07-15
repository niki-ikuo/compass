import { describe, expect, it } from 'vitest'
import {
  closeTruncatedJson,
  coerceProposeActionsArgs,
  escapeControlCharsInJsonStrings,
  extractCompleteActions,
  isIncompleteJson,
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

  it('wraps a single action object as an array', () => {
    const action = { type: 'writeFile', path: 'solo.ts', content: 'one' }
    const result = coerceProposeActionsArgs({ actions: action })
    expect(result.actions).toEqual([action])
  })

  it('recovers a stringified single action object', () => {
    const action = { type: 'mkdir', path: 'pkg' }
    const result = coerceProposeActionsArgs({
      actions: JSON.stringify(action)
    })
    expect(result.actions).toEqual([action])
  })

  it('recovers from _raw when content has literal newlines (broken JSON)', () => {
    const broken =
      '{"actions":[{"type":"writeFile","path":"src/board.js","content":"\\"use strict\\";\n\nconst pieces = require(\'./pieces\');\n"}]}'
    const result = coerceProposeActionsArgs({ _raw: broken })
    expect(result.actions).toEqual([
      {
        type: 'writeFile',
        path: 'src/board.js',
        content: `"use strict";\n\nconst pieces = require('./pieces');\n`
      }
    ])
  })

  it('recovers complete actions from truncated multi-action JSON in _raw', () => {
    const truncated =
      '{"actions":[{"type":"writeFile","path":"a.js","content":"ok"},{"type":"writeFile","path":"b.js","content":"cut mid'
    const result = coerceProposeActionsArgs({ _raw: truncated })
    expect(result.actions).toEqual([{ type: 'writeFile', path: 'a.js', content: 'ok' }])
  })

  it('does not force-close a truncated single writeFile into a partial preview', () => {
    const truncated =
      '{"actions":[{"type":"writeFile","path":"src/board.js","content":"\\"use strict\\";\\n\\nconst pieces = require(\'./pieces\');'
    const result = coerceProposeActionsArgs({ _raw: truncated })
    expect(result.actions).toBeUndefined()
    expect(result._raw).toBe(truncated)
  })

  it('recovers truncated mkdir-only payloads by closing JSON', () => {
    const truncated = '{"actions":[{"type":"mkdir","path":"src/new"'
    const result = coerceProposeActionsArgs({ _raw: truncated })
    expect(result.actions).toEqual([{ type: 'mkdir', path: 'src/new' }])
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

  it('treats a root actions array as proposeActions args', () => {
    const actions = [{ type: 'deleteDir', path: 'tmp' }]
    expect(parseToolArgs(JSON.stringify(actions))).toEqual({ actions })
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

describe('json recovery helpers', () => {
  it('escapes literal newlines inside JSON strings', () => {
    const input = '{"content":"line1\nline2"}'
    expect(escapeControlCharsInJsonStrings(input)).toBe('{"content":"line1\\nline2"}')
    expect(JSON.parse(escapeControlCharsInJsonStrings(input))).toEqual({
      content: 'line1\nline2'
    })
  })

  it('closes truncated objects and arrays', () => {
    const closed = closeTruncatedJson('{"actions":[{"type":"mkdir","path":"x"')
    expect(JSON.parse(closed)).toEqual({
      actions: [{ type: 'mkdir', path: 'x' }]
    })
  })

  it('closes truncated JSON that ends mid-escape (dangling backslash)', () => {
    const raw = '{"actions":[{"type":"writeFile","path":"a.js","content":"hello\\'
    expect(JSON.parse(closeTruncatedJson(raw))).toEqual({
      actions: [{ type: 'writeFile', path: 'a.js', content: 'hello' }]
    })
  })

  it('closes truncated JSON that ends mid-unicode escape', () => {
    const raw = '{"actions":[{"type":"writeFile","path":"a.js","content":"hi\\u00'
    expect(JSON.parse(closeTruncatedJson(raw))).toEqual({
      actions: [{ type: 'writeFile', path: 'a.js', content: 'hi' }]
    })
  })

  it('detects incomplete JSON payloads', () => {
    expect(isIncompleteJson('{"actions":[{"type":"writeFile","path":"a.js","content":"hello')).toBe(
      true
    )
    expect(isIncompleteJson('{"actions":[{"type":"mkdir","path":"x"}]}')).toBe(false)
  })

  it('does not coerce a writeFile truncated after an escape boundary', () => {
    const raw =
      '{"actions":[{"type":"writeFile","path":"src/board.js","content":"hello\\'
    const result = coerceProposeActionsArgs({ _raw: raw })
    expect(result.actions).toBeUndefined()
    expect(result._raw).toBe(raw)
  })

  it('recovers when content has invalid backslash-apostrophe escapes', () => {
    const raw =
      '{"actions":[{"type":"writeFile","path":"src/board.js","content":"const pieces = require(\\\'./pieces\\\');"}]}'
    const result = coerceProposeActionsArgs({ _raw: raw })
    expect(result.actions).toEqual([
      {
        type: 'writeFile',
        path: 'src/board.js',
        content: "const pieces = require('./pieces');"
      }
    ])
  })

  it('extracts only complete action objects', () => {
    const text =
      'noise {"type":"writeFile","path":"a.ts","content":"x"} {"type":"writeFile","path":"b.ts","content":"partial'
    expect(extractCompleteActions(text)).toEqual([
      { type: 'writeFile', path: 'a.ts', content: 'x' }
    ])
  })
})
