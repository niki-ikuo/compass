import { describe, expect, it } from 'vitest'
import { deflateSync } from 'zlib'
import { getImageMimeType, isImagePath, isMediaPath, isPdfPath, getMediaViewKind } from '@/utils/media-context'
import { extractPdfText } from '@/utils/pdf-text'
import { toApiUserContent, type UserMessagePayload } from '@/utils/chat-content-parts'

function buildMinimalPdf(contentStream: string): Buffer {
  const objects: string[] = []
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n')
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n')
  objects.push(
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n'
  )
  objects.push(
    `4 0 obj<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>stream\n${contentStream}\nendstream\nendobj\n`
  )
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n')

  let body = '%PDF-1.1\n'
  const offsets: number[] = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += obj
  }
  const xrefStart = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n`
  body += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

describe('media-context', () => {
  it('detects image and pdf paths', () => {
    expect(isImagePath('shot.PNG')).toBe(true)
    expect(getImageMimeType('a/b/photo.jpeg')).toBe('image/jpeg')
    expect(isPdfPath('docs/spec.PDF')).toBe(true)
    expect(isImagePath('notes.md')).toBe(false)
    expect(isMediaPath('a.png')).toBe(true)
    expect(getMediaViewKind('x.pdf')).toBe('pdf')
  })
})

describe('extractPdfText', () => {
  it('extracts literal strings from a simple PDF', () => {
    const pdf = buildMinimalPdf('BT /F1 24 Tf 100 700 Td (Hello PDF) Tj ET')
    const result = extractPdfText(pdf, 10_000)
    expect(result.text).toContain('Hello PDF')
    expect(result.truncated).toBe(false)
  })

  it('extracts text from FlateDecode streams', () => {
    const streamText = 'BT /F1 12 Tf 50 700 Td (Compressed Hello) Tj ET'
    const compressed = deflateSync(Buffer.from(streamText, 'latin1'))
    const objects: string[] = []
    objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n')
    objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n')
    objects.push(
      '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n'
    )
    const streamBody = compressed.toString('latin1')
    objects.push(
      `4 0 obj<< /Length ${compressed.length} /Filter /FlateDecode >>stream\n${streamBody}\nendstream\nendobj\n`
    )
    objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n')

    let body = '%PDF-1.1\n'
    const offsets: number[] = [0]
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(body, 'latin1'))
      body += obj
    }
    const xrefStart = Buffer.byteLength(body, 'latin1')
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (let i = 1; i <= objects.length; i++) {
      body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
    }
    body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

    const result = extractPdfText(Buffer.from(body, 'latin1'), 10_000)
    expect(result.text).toContain('Compressed Hello')
  })

  it('returns empty for non-pdf buffers', () => {
    expect(extractPdfText(Buffer.from('not a pdf'), 100).text).toBe('')
  })
})

describe('toApiUserContent', () => {
  it('returns plain string when there are no images', () => {
    const payload: UserMessagePayload = { text: 'hello', images: [] }
    expect(toApiUserContent(payload)).toBe('hello')
  })

  it('builds multipart content with data URLs', () => {
    const payload: UserMessagePayload = {
      text: 'describe this',
      images: [{ relativePath: 'a.png', mimeType: 'image/png', base64: 'QUJD' }]
    }
    const content = toApiUserContent(payload)
    expect(Array.isArray(content)).toBe(true)
    expect(content).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }
    ])
  })
})
