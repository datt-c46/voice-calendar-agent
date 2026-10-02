import { ipcMain } from 'electron'
import { SpeechToTextManager } from '../voice/stt/sttManager'
import { TranscribeAudioRequest, STTResult } from '../voice/stt/types'

export function registerSttIpc(sttManager: SpeechToTextManager): void {
  ipcMain.handle(
    'stt:transcribe',
    async (_event, request: TranscribeAudioRequest): Promise<STTResult> => {
      try {
        if (!request || !request.audioBase64) {
          throw new Error('Audio payload is empty.')
        }

        const result = await sttManager.transcribe({
          base64: request.audioBase64,
          mimeType: request.mimeType || 'audio/wav',
          sampleRate: request.sampleRate || 16000,
          language: request.language,
          durationMs: request.durationMs,
          interactionId: request.interactionId
        })

        return result
      } catch (err: unknown) {
        const errorMsg = (err as Error)?.message || 'Speech-to-Text transcription failed.'
        console.error('[IPC:stt:transcribe] Error:', errorMsg)
        throw new Error(errorMsg)
      }
    }
  )

  ipcMain.handle('stt:get-status', async () => {
    return sttManager.getStatus()
  })
}
