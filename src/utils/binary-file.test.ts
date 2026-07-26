import { describe, expect, it } from 'vitest'
import {
  formatByteSize,
  isBinaryExtensionPath,
  isProbablyBinaryBytes
} from '@/utils/binary-file'

describe('isBinaryExtensionPath', () => {
  it('detects common binary extensions case-insensitively', () => {
    expect(isBinaryExtensionPath('a/b/app.EXE')).toBe(true)
    expect(isBinaryExtensionPath('lib.wasm')).toBe(true)
    expect(isBinaryExtensionPath('archive.tar.gz')).toBe(true)
    expect(isBinaryExtensionPath('archive.tgz')).toBe(true)
    expect(isBinaryExtensionPath('font.woff2')).toBe(true)
  })

  it('does not treat text / media / office as binary extensions', () => {
    expect(isBinaryExtensionPath('notes.md')).toBe(false)
    expect(isBinaryExtensionPath('main.ts')).toBe(false)
    expect(isBinaryExtensionPath('photo.png')).toBe(false)
    expect(isBinaryExtensionPath('doc.pdf')).toBe(false)
    expect(isBinaryExtensionPath('sheet.xlsx')).toBe(false)
    expect(isBinaryExtensionPath('vector.svg')).toBe(false)
  })
})

describe('isProbablyBinaryBytes', () => {
  it('returns false for empty and plain text', () => {
    expect(isProbablyBinaryBytes(new Uint8Array())).toBe(false)
    expect(isProbablyBinaryBytes(new TextEncoder().encode('hello\nworld'))).toBe(false)
  })

  it('returns true when NUL is present', () => {
    expect(isProbablyBinaryBytes(new Uint8Array([0x00, 0x01, 0x02]))).toBe(true)
    expect(isProbablyBinaryBytes(new Uint8Array([0x41, 0x00, 0x42]))).toBe(true)
  })

  it('treats UTF-16 BOM buffers as text', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42])
    expect(isProbablyBinaryBytes(le)).toBe(false)
    expect(isProbablyBinaryBytes(be)).toBe(false)
  })

  it('treats ASCII-heavy UTF-16 without BOM as text', () => {
    // "AB" as UTF-16LE without BOM: 41 00 42 00 …
    const bytes = new Uint8Array(64)
    for (let i = 0; i < 32; i++) {
      bytes[i * 2] = 0x41 + (i % 26)
      bytes[i * 2 + 1] = 0
    }
    expect(isProbablyBinaryBytes(bytes)).toBe(false)
  })
})

describe('formatByteSize', () => {
  it('formats byte sizes', () => {
    expect(formatByteSize(0)).toBe('0 B')
    expect(formatByteSize(512)).toBe('512 B')
    expect(formatByteSize(1536)).toBe('1.5 KB')
    expect(formatByteSize(1024 * 1024)).toBe('1.0 MB')
  })
})
