import { inflateRawSync } from 'zlib'

/** Read one stored/deflated ZIP entry by exact path (forward slashes). */
export function readZipEntry(buffer: Buffer, entryName: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(buffer)
  if (!eocd) return null

  const entryCount = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length) return null
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return null

    const compression = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const name = buffer.subarray(nameStart, nameStart + nameLen).toString('utf8')
    offset = nameStart + nameLen + extraLen + commentLen

    if (name !== entryName) continue
    return inflateZipLocalEntry(buffer, localHeaderOffset, compression, compressedSize)
  }

  return null
}

/** List entry names from the central directory (forward slashes). */
export function listZipEntryNames(buffer: Buffer): string[] {
  const eocd = findEndOfCentralDirectory(buffer)
  if (!eocd) return []

  const entryCount = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const names: string[] = []

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length) break
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break

    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const nameStart = offset + 46
    names.push(buffer.subarray(nameStart, nameStart + nameLen).toString('utf8'))
    offset = nameStart + nameLen + extraLen + commentLen
  }

  return names
}

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50
}

function findEndOfCentralDirectory(buffer: Buffer): number | null {
  // EOCD is at the end; comment may be up to 64KiB.
  const min = Math.max(0, buffer.length - (22 + 0xffff))
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i
  }
  return null
}

function inflateZipLocalEntry(
  buffer: Buffer,
  localHeaderOffset: number,
  compression: number,
  compressedSize: number
): Buffer | null {
  if (localHeaderOffset + 30 > buffer.length) return null
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null

  const nameLen = buffer.readUInt16LE(localHeaderOffset + 26)
  const extraLen = buffer.readUInt16LE(localHeaderOffset + 28)
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen
  const dataEnd = dataStart + compressedSize
  if (dataEnd > buffer.length) return null

  const compressed = buffer.subarray(dataStart, dataEnd)
  if (compression === 0) return Buffer.from(compressed)
  if (compression === 8) {
    try {
      return inflateRawSync(compressed)
    } catch {
      return null
    }
  }
  return null
}
