import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'zlib'
import { extractDocxText } from './docx-text'

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
  }
  return ~c >>> 0
}

/** Minimal single-entry ZIP (deflate) for tests. */
function buildZip(entryName: string, content: string): Buffer {
  const name = Buffer.from(entryName, 'utf8')
  const raw = Buffer.from(content, 'utf8')
  const compressed = deflateRawSync(raw)
  const crc = crc32(raw)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(8, 8) // deflate
  local.writeUInt16LE(0, 10)
  local.writeUInt16LE(0, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(8, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34)
  central.writeUInt16LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(0, 42) // local header offset

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length + name.length, 12)
  eocd.writeUInt32LE(local.length + name.length + compressed.length, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([local, name, compressed, central, name, eocd])
}

describe('extractDocxText', () => {
  it('extracts paragraph text from word/document.xml', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>
    <w:p><w:r><w:t>第二段落</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const zip = buildZip('word/document.xml', xml)
    const result = extractDocxText(zip, 10_000)
    expect(result.text).toContain('Hello world')
    expect(result.text).toContain('第二段落')
    expect(result.truncated).toBe(false)
  })

  it('respects maxChars', () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>ABCDEFGHIJKLMNOP</w:t></w:r></w:p></w:body>
</w:document>`
    const result = extractDocxText(buildZip('word/document.xml', xml), 5)
    expect(result.text).toBe('ABCDE')
    expect(result.truncated).toBe(true)
  })

  it('returns empty for non-zip input', () => {
    expect(extractDocxText(Buffer.from('not a docx'), 100).text).toBe('')
  })
})
