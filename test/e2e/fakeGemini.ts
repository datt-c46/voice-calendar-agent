/**
 * Local stand-in for the Gemini REST API (`POST /v1beta/models/<model>:generateContent`). voice-backend's
 * @google/genai client is pointed at it with GOOGLE_GEMINI_BASE_URL, so the real STT code path runs end to end
 * without a Google account or network access.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface GeminiCall {
  path: string
  model: string
  hasAudio: boolean
  audioMimeType: string | null
  audioBytes: number
}

export interface FakeGemini {
  url: string
  /** Transcripts returned in order for audio requests; an empty queue answers "" (silence). */
  transcripts: string[]
  calls: GeminiCall[]
  /** Answer the next `count` audio requests with this HTTP status (e.g. 503 overload). */
  fail: { status: number; count: number } | null
  close(): Promise<void>
}

interface Part {
  text?: string
  inlineData?: { mimeType?: string; data?: string }
}

export async function startFakeGemini(): Promise<FakeGemini> {
  const fake: Omit<FakeGemini, 'url' | 'close'> = { transcripts: [], calls: [], fail: null }

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0] ?? ''
      const match = /\/models\/([^/:]+):generateContent$/.exec(path)
      if (req.method !== 'POST' || !match) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }))
        return
      }
      let audio: Part['inlineData'] | undefined
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          contents?: Array<{ parts?: Part[] }>
        }
        audio = body.contents?.flatMap((c) => c.parts ?? []).find((p) => p.inlineData)?.inlineData
      } catch {
        // malformed body: treated as a text request
      }
      fake.calls.push({
        path,
        model: match[1] ?? '',
        hasAudio: !!audio,
        audioMimeType: audio?.mimeType ?? null,
        audioBytes: audio?.data ? Buffer.from(audio.data, 'base64').length : 0
      })
      if (audio && fake.fail && fake.fail.count > 0) {
        const status = fake.fail.status
        fake.fail.count--
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: { code: status, message: 'fake failure', status: 'UNAVAILABLE' }
          })
        )
        return
      }
      const text = audio ? (fake.transcripts.shift() ?? '') : ''
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          candidates: [
            { content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
        })
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  })
}
