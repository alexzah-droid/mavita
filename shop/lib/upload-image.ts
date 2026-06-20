export type UploadImageType = { ext: string; mime: 'image/jpeg' | 'image/png' | 'image/webp' }

export function detectImageType(data: Buffer): UploadImageType | null {
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { ext: 'jpg', mime: 'image/jpeg' }
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: 'png', mime: 'image/png' }
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
  return null
}

/** Возвращает размеры только для декодируемого заголовка поддерживаемого формата. */
export function imageDimensions(data: Buffer, mime: string): [number, number] | null {
  if (mime === 'image/png' && data.length >= 24) return [data.readUInt32BE(16), data.readUInt32BE(20)]
  if (mime === 'image/webp' && data.length >= 20) {
    const kind = data.subarray(12, 16).toString()
    const chunkLength = data.readUInt32LE(16)
    if (kind === 'VP8X' && chunkLength >= 10 && data.length >= 30) return [1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3)]
    if (kind === 'VP8 ' && chunkLength >= 10 && data.length >= 30 && data.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff]
    if (kind === 'VP8L' && chunkLength >= 5 && data.length >= 25 && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21)
      return [1 + (bits & 0x3fff), 1 + (Math.floor(bits / 0x4000) & 0x3fff)]
    }
  }
  if (mime === 'image/jpeg') for (let i = 2; i + 9 < data.length;) { if (data[i] !== 0xff) { i++; continue }; const marker = data[i + 1]; const length = data.readUInt16BE(i + 2); if (marker >= 0xc0 && marker <= 0xc3) return [data.readUInt16BE(i + 7), data.readUInt16BE(i + 5)]; i += 2 + length }
  return null
}
