import { describe, expect, it } from 'vitest'
import { ApplyPatchError, applyUnifiedDiff, parseUnifiedDiff } from './apply-patch'

describe('parseUnifiedDiff', () => {
  it('parses a standard hunk', () => {
    const patch = `--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 line1
-line2
+line2b
 line3
+line4
`
    const hunks = parseUnifiedDiff(patch)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].lines.filter((l) => l.kind === 'add')).toHaveLength(2)
  })
})

describe('applyUnifiedDiff', () => {
  it('replaces a middle line', () => {
    const original = 'a\nb\nc\n'
    const patch = `@@ -1,3 +1,3 @@
 a
-b
+B
 c
`
    expect(applyUnifiedDiff(original, patch)).toBe('a\nB\nc\n')
  })

  it('inserts into an empty file', () => {
    const patch = `--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+hello
+world
`
    expect(applyUnifiedDiff('', patch)).toBe('hello\nworld\n')
  })

  it('applies multiple hunks', () => {
    const original = 'one\ntwo\nthree\nfour\nfive\n'
    const patch = `@@ -1,2 +1,2 @@
-one
+ONE
 two
@@ -4,2 +4,2 @@
 four
-five
+FIVE
`
    expect(applyUnifiedDiff(original, patch)).toBe('ONE\ntwo\nthree\nfour\nFIVE\n')
  })

  it('finds context when line numbers drift', () => {
    const original = 'alpha\nbeta\ngamma\n'
    const patch = `@@ -10,3 +10,3 @@
 alpha
-beta
+BETA
 gamma
`
    expect(applyUnifiedDiff(original, patch)).toBe('alpha\nBETA\ngamma\n')
  })

  it('throws when context is missing', () => {
    const original = 'a\nb\nc\n'
    const patch = `@@ -1,3 +1,3 @@
 a
-missing
+x
 c
`
    expect(() => applyUnifiedDiff(original, patch)).toThrow(ApplyPatchError)
  })

  it('supports bare @@ hunks without counts', () => {
    const original = 'foo\nbar\n'
    const patch = `@@
 foo
-bar
+baz
`
    expect(applyUnifiedDiff(original, patch)).toBe('foo\nbaz\n')
  })
})
