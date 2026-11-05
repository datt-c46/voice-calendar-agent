import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeError, parseIpcError } from '../src/shared/errors'
import { DEFAULT_BACKEND_URL, resolveBackendConfig } from '../src/main/backend/config'
import { parseEnvFile } from '../src/main/envConfig'
import { chunkTextForTts } from '../src/renderer/src/services/tts/piperProvider'
import {
  formatEventDate,
  formatEventTime,
  lastAllDayDate
} from '../src/renderer/src/utils/eventFormat'
import { vadAssetBaseUrl } from '../src/renderer/src/utils/vadAssets'

describe('resolveBackendConfig', () => {
  it('defaults to localhost:4000', () => {
    const c = resolveBackendConfig({})
    assert.equal(c.baseUrl, DEFAULT_BACKEND_URL)
    assert.equal(c.apiUrl, `${DEFAULT_BACKEND_URL}/api/v1`)
    assert.equal(c.devLoginEmail, null)
    assert.equal(c.warning, null)
  })

  it('accepts http(s) URLs with a path prefix and strips trailing slashes', () => {
    const c = resolveBackendConfig({ VOICE_BACKEND_URL: ' https://api.example.com/voice/ ' })
    assert.equal(c.apiUrl, 'https://api.example.com/voice/api/v1')
  })

  it('rejects other schemes, credentials and query strings', () => {
    for (const bad of [
      'file:///tmp',
      'javascript:alert(1)',
      'http://u:p@host',
      'http://host/?x=1',
      'not a url'
    ]) {
      const c = resolveBackendConfig({ VOICE_BACKEND_URL: bad })
      assert.equal(c.baseUrl, DEFAULT_BACKEND_URL, bad)
      assert.ok(c.warning, bad)
    }
  })

  it('only offers dev login for a plausible email', () => {
    assert.equal(
      resolveBackendConfig({ VOICE_BACKEND_DEV_EMAIL: 'dev@example.com' }).devLoginEmail,
      'dev@example.com'
    )
    assert.equal(resolveBackendConfig({ VOICE_BACKEND_DEV_EMAIL: 'nope' }).devLoginEmail, null)
  })
})

describe('parseEnvFile', () => {
  it('keeps only VOICE_BACKEND_* keys (old secrets in .env are ignored)', () => {
    const parsed = parseEnvFile(
      [
        '# comment',
        'GOOGLE_CLIENT_SECRET=should-not-load',
        'GEMINI_API_KEY="nope"',
        'VOICE_BACKEND_URL="http://localhost:4000"',
        "VOICE_BACKEND_DEV_EMAIL='dev@example.com'",
        'VOICE_BACKEND_EMPTY=',
        'garbage line'
      ].join('\r\n')
    )
    assert.deepEqual(parsed, {
      VOICE_BACKEND_URL: 'http://localhost:4000',
      VOICE_BACKEND_DEV_EMAIL: 'dev@example.com'
    })
  })
})

describe('error codes', () => {
  it('describes known codes and falls back to the server message', () => {
    assert.match(describeError('RATE_LIMITED'), /quá nhanh/)
    assert.equal(describeError('SOMETHING_NEW', 'server text'), 'server text')
    assert.equal(describeError('constructor', 'fallback'), 'fallback') // no prototype lookups
  })

  it('parses codes out of Electron IPC errors', () => {
    const e = new Error(
      "Error invoking remote method 'stt:transcribe': Error: STT_UNAVAILABLE: Speech-to-text is disabled"
    )
    assert.deepEqual(parseIpcError(e), {
      code: 'STT_UNAVAILABLE',
      message: 'Server chưa bật nhận dạng giọng nói.'
    })
    const unknown = parseIpcError(new Error("Error invoking remote method 'x': Error: boom"))
    assert.deepEqual(unknown, { code: undefined, message: 'boom' })
    assert.equal(parseIpcError(new Error('NEW_CODE: details')).message, 'details')
  })
})

describe('chunkTextForTts', () => {
  it('keeps short text whole', () => {
    assert.deepEqual(chunkTextForTts('  Xin chào.  '), ['Xin chào.'])
    assert.deepEqual(chunkTextForTts('   '), [])
  })

  it('splits long text at sentence, then word boundaries, within the limit', () => {
    const sentence = 'Bạn có cuộc họp nhóm lúc 9 giờ sáng mai tại phòng họp lớn. '
    const text = sentence.repeat(40)
    const chunks = chunkTextForTts(text, 200)
    assert.ok(chunks.length > 1)
    for (const c of chunks) {
      assert.ok(c.length <= 200, `${c.length}`)
      assert.ok(c.endsWith('.'), c)
    }
    assert.equal(chunks.join(' '), text.trim())

    const words = chunkTextForTts('từ '.repeat(500), 100)
    assert.ok(words.every((c) => c.length <= 100 && !c.startsWith(' ')))
    const blob = chunkTextForTts('x'.repeat(250), 100)
    assert.deepEqual(
      blob.map((c) => c.length),
      [100, 100, 50]
    )
  })
})

describe('event formatting', () => {
  it('formats in the event time zone', () => {
    assert.equal(formatEventTime('2026-11-06T15:00:00+07:00', 'Asia/Bangkok'), '15:00 • 06/11/2026')
    assert.equal(
      formatEventTime('2026-11-06T15:00:00+07:00', 'America/New_York'),
      '03:00 • 06/11/2026'
    )
    assert.equal(formatEventTime('garbage'), 'garbage')
  })

  it('ignores an invalid time zone instead of throwing', () => {
    assert.match(
      formatEventTime('2026-11-06T15:00:00+07:00', 'Mars/Base'),
      /^\d{2}:\d{2} • \d{2}\/\d{2}\/2026$/
    )
  })

  it('handles all-day dates with an exclusive end', () => {
    assert.equal(formatEventDate('2026-11-06'), '06/11/2026')
    assert.equal(lastAllDayDate('2026-11-06', '2026-11-07'), null) // single day
    assert.equal(lastAllDayDate('2026-11-06', '2026-11-09'), '2026-11-08')
    assert.equal(lastAllDayDate('2026-12-31', '2027-01-02'), '2027-01-01')
  })
})

describe('vadAssetBaseUrl', () => {
  it('points next to index.html in dev (http) and in the packaged app (file://)', () => {
    assert.equal(vadAssetBaseUrl('http://localhost:5173/'), 'http://localhost:5173/vad/')
    assert.equal(
      vadAssetBaseUrl('file:///opt/app/resources/app.asar/out/renderer/index.html'),
      'file:///opt/app/resources/app.asar/out/renderer/vad/'
    )
  })
})
