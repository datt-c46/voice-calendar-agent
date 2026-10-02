import { AudioData, STTResult } from './types'

export interface ISpeechToTextProvider {
  readonly id: string
  readonly name: string
  isAvailable(): Promise<boolean>
  transcribe(audio: AudioData): Promise<STTResult>
}
