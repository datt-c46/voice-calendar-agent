import { ipcMain } from 'electron'
import { PiperTtsManager } from '../voice/tts/piperManager'
import { PiperSynthesizeRequest, PiperSynthesizeResult, PiperStatusDTO } from '../voice/tts/types'

export function registerTtsIpc(piperManager: PiperTtsManager): void {
  ipcMain.handle(
    'tts:piper:synthesize',
    async (_event, request: PiperSynthesizeRequest): Promise<PiperSynthesizeResult> => {
      try {
        if (!request || !request.text) {
          throw new Error('Synthesis request text is empty.')
        }
        return await piperManager.synthesize(request)
      } catch (err: unknown) {
        const errorMsg = (err as Error)?.message || 'Piper TTS synthesis failed.'
        console.error('[IPC:tts:piper:synthesize] Error:', errorMsg)
        throw new Error(errorMsg)
      }
    }
  )

  ipcMain.handle('tts:piper:get-status', async (): Promise<PiperStatusDTO> => {
    return piperManager.getStatus()
  })

  ipcMain.handle('tts:piper:get-voices', async () => {
    return piperManager.getVoices()
  })

  ipcMain.handle('tts:piper:set-voice', async (_event, voiceId: string): Promise<boolean> => {
    return piperManager.setActiveVoice(voiceId)
  })
}
