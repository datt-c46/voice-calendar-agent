/**
 * Audio Encoding Utility for Voice Activity Detection and STT
 * Encodes Float32Array (16kHz mono) to 16-bit PCM WAV format and Base64.
 */

export function encodeWav(samples: Float32Array, sampleRate: number = 16000): ArrayBuffer {
  const numChannels = 1
  const bytesPerSample = 2 // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const bufferSize = 44 + dataSize

  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)

  // RIFF Chunk Descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // Subchunk1Size for PCM
  view.setUint16(20, 1, true) // AudioFormat 1 = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // BitsPerSample

  // "data" sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Write 16-bit PCM samples
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return buffer
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

export function float32ToWavBase64(samples: Float32Array, sampleRate: number = 16000): string {
  const wavBuffer = encodeWav(samples, sampleRate)
  return arrayBufferToBase64(wavBuffer)
}
