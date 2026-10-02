import { spawn, execSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import {
  PiperSynthesizeRequest,
  PiperSynthesizeResult,
  PiperStatusDTO,
  PiperVoiceModelInfo
} from './types'

export interface PiperManagerOptions {
  binaryPath?: string
  modelsDir?: string
  defaultVoiceId?: string
  fallbackMode?: 'mock' | 'error'
}

/**
 * Generates a valid minimal PCM WAV buffer for fallback/mock synthesis.
 */
function createFallbackWavBuffer(sampleRate = 22050, durationSec = 0.5): Buffer {
  const numSamples = Math.floor(sampleRate * durationSec)
  const bytesPerSample = 2 // 16-bit PCM
  const blockAlign = bytesPerSample // 1 channel
  const byteRate = sampleRate * blockAlign
  const dataSize = numSamples * bytesPerSample
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const buffer = Buffer.alloc(totalSize)

  // RIFF chunk descriptor
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(totalSize - 8, 4)
  buffer.write('WAVE', 8)

  // fmt sub-chunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // Subchunk1Size for PCM
  buffer.writeUInt16LE(1, 20) // AudioFormat: 1 = PCM
  buffer.writeUInt16LE(1, 22) // NumChannels: 1 = mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34) // BitsPerSample: 16

  // data sub-chunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // Generate subtle tone / silence
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    // 440 Hz gentle sine wave faded in/out
    const envelope = Math.sin((Math.PI * i) / numSamples)
    const sample = Math.floor(Math.sin(2 * Math.PI * 440 * t) * 3000 * envelope)
    buffer.writeInt16LE(sample, headerSize + i * 2)
  }

  return buffer
}

/**
 * Piper TTS Manager in Electron Main Process.
 * Responsible for discovering local Piper models, managing voice configurations,
 * and executing speech synthesis via local Piper binary or Python CLI.
 */
export class PiperTtsManager {
  private executablePath: string | null = null
  private engineType: 'executable' | 'python' | 'built-in' | 'mock' = 'mock'
  private voices: Map<string, PiperVoiceModelInfo> = new Map()
  private activeVoiceId: string | null = null
  private isAvailable = false
  private initializationError: string | null = null
  private options: PiperManagerOptions

  constructor(options: PiperManagerOptions = {}) {
    this.options = options
  }

  public async initialize(): Promise<void> {
    try {
      this.detectExecutable()
      this.discoverVoiceModels()

      // Select active voice
      if (this.options.defaultVoiceId && this.voices.has(this.options.defaultVoiceId)) {
        this.activeVoiceId = this.options.defaultVoiceId
      } else if (this.voices.size > 0) {
        // Prefer Vietnamese voice if available
        const viVoice = Array.from(this.voices.values()).find((v) => v.lang.startsWith('vi'))
        this.activeVoiceId = viVoice ? viVoice.id : Array.from(this.voices.keys())[0]
      }

      this.isAvailable = this.engineType !== 'mock' || this.voices.size > 0
      console.log(
        `[PiperManager] Initialized with engineType="${this.engineType}", executable="${this.executablePath || 'none'}", voicesCount=${this.voices.size}, activeVoice="${this.activeVoiceId || 'none'}"`
      )
    } catch (err: unknown) {
      this.initializationError = (err as Error)?.message || String(err)
      console.error('[PiperManager] Initialization error:', this.initializationError)
    }
  }

  /**
   * Search for Piper binary or Python CLI
   */
  private detectExecutable(): void {
    // 1. Explicit path in options or env
    const explicitPath =
      this.options.binaryPath ||
      process.env.PIPER_BINARY_PATH ||
      process.env.PIPER_EXECUTABLE_PATH

    if (explicitPath && existsSync(explicitPath)) {
      this.executablePath = explicitPath
      this.engineType = 'executable'
      return
    }

    // 2. Common bundle paths in Electron resources
    const possiblePaths = [
      join(process.cwd(), 'resources', 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper'),
      join(process.cwd(), 'resources', 'bin', process.platform === 'win32' ? 'piper.exe' : 'piper'),
      join(__dirname, '../../resources/piper', process.platform === 'win32' ? 'piper.exe' : 'piper'),
      'D:\\DATT\\piper\\src\\cpp\\piper.exe'
    ]

    for (const p of possiblePaths) {
      if (existsSync(p)) {
        this.executablePath = p
        this.engineType = 'executable'
        return
      }
    }

    // 3. Check for Python piper-tts module
    try {
      const checkPy = execSync('python -m piper -h', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 })
      if (checkPy) {
        this.executablePath = 'python'
        this.engineType = 'python'
        return
      }
    } catch {
      // Python piper module not available
    }

    // Fallback: Default to built-in/mock mode if no standalone binary is installed
    this.engineType = 'mock'
  }

  /**
   * Scan directory for .onnx and .onnx.json files
   */
  public discoverVoiceModels(): void {
    const searchDirs: string[] = []

    if (this.options.modelsDir) {
      searchDirs.push(this.options.modelsDir)
    }
    if (process.env.PIPER_MODEL_DIR) {
      searchDirs.push(process.env.PIPER_MODEL_DIR)
    }

    // Default search locations
    searchDirs.push(
      join(process.cwd(), 'resources', 'models', 'piper'),
      join(process.cwd(), 'resources', 'piper', 'models'),
      join(process.cwd(), 'resources', 'piper'),
      'D:\\DATT\\piper\\etc',
      'D:\\DATT\\piper\\models'
    )

    for (const dir of searchDirs) {
      if (existsSync(dir)) {
        this.scanDirectoryForModels(dir)
      }
    }

    // If explicit PIPER_MODEL_PATH is provided in .env
    const explicitModelPath = process.env.PIPER_MODEL_PATH
    if (explicitModelPath && existsSync(explicitModelPath)) {
      const explicitConfigPath =
        process.env.PIPER_CONFIG_PATH || `${explicitModelPath}.json`
      this.registerModelFile(explicitModelPath, explicitConfigPath)
    }

    // If no Vietnamese models found on disk, ensure standard Vietnamese Piper Voice definitions are registered
    const hasViVoice = Array.from(this.voices.values()).some((v) => v.lang.startsWith('vi'))
    if (!hasViVoice) {
      this.registerStandardDefaultVoices()
    }
  }

  private scanDirectoryForModels(dir: string): void {
    try {
      const files = readdirSync(dir)
      for (const file of files) {
        if (file.endsWith('.onnx') && !file.includes('silero_vad')) {
          const modelPath = join(dir, file)
          const configPath = join(dir, `${file}.json`)
          this.registerModelFile(modelPath, configPath)
        }
      }
    } catch (err) {
      console.warn(`[PiperManager] Could not read models from ${dir}:`, err)
    }
  }

  private registerModelFile(modelPath: string, configPath: string): void {
    try {
      const fileName = basename(modelPath, '.onnx')
      let lang = 'vi-VN'
      let sampleRate = 22050
      let numSpeakers = 1

      if (existsSync(configPath)) {
        try {
          const configJson = JSON.parse(readFileSync(configPath, 'utf-8'))
          if (configJson.language?.code) {
            lang = configJson.language.code
          } else if (fileName.startsWith('vi_VN')) {
            lang = 'vi-VN'
          } else if (fileName.startsWith('en_US')) {
            lang = 'en-US'
          }

          if (configJson.audio?.sample_rate) {
            sampleRate = configJson.audio.sample_rate
          }
          if (configJson.num_speakers) {
            numSpeakers = configJson.num_speakers
          }
        } catch {
          // Ignore json parse error
        }
      }

      const voiceInfo: PiperVoiceModelInfo = {
        id: fileName,
        name: `Piper ${fileName}`,
        lang,
        modelPath,
        configPath: existsSync(configPath) ? configPath : `${modelPath}.json`,
        sampleRate,
        numSpeakers,
        isDefault: fileName.includes('vivos') || fileName.includes('vi_VN')
      }

      this.voices.set(voiceInfo.id, voiceInfo)
    } catch (err) {
      console.warn(`[PiperManager] Error registering model file ${modelPath}:`, err)
    }
  }

  private registerStandardDefaultVoices(): void {
    const defaultViVos: PiperVoiceModelInfo = {
      id: 'vi_VN-vivos-x_low',
      name: 'Piper Vietnamese VIVOS (x_low)',
      lang: 'vi-VN',
      modelPath: join(process.cwd(), 'resources', 'models', 'piper', 'vi_VN-vivos-x_low.onnx'),
      configPath: join(process.cwd(), 'resources', 'models', 'piper', 'vi_VN-vivos-x_low.onnx.json'),
      sampleRate: 16000,
      quality: 'x_low',
      isDefault: true
    }

    const defaultVi25h: PiperVoiceModelInfo = {
      id: 'vi_VN-25hours-low',
      name: 'Piper Vietnamese 25Hours (low)',
      lang: 'vi-VN',
      modelPath: join(process.cwd(), 'resources', 'models', 'piper', 'vi_VN-25hours-low.onnx'),
      configPath: join(process.cwd(), 'resources', 'models', 'piper', 'vi_VN-25hours-low.onnx.json'),
      sampleRate: 22050,
      quality: 'low',
      isDefault: false
    }

    this.voices.set(defaultViVos.id, defaultViVos)
    this.voices.set(defaultVi25h.id, defaultVi25h)
  }

  /**
   * Synthesize text to WAV audio
   */
  public async synthesize(request: PiperSynthesizeRequest): Promise<PiperSynthesizeResult> {
    const text = request.text?.trim()
    if (!text) {
      throw new Error('Synthesis text cannot be empty.')
    }

    const voiceId = request.voiceId || this.activeVoiceId || Array.from(this.voices.keys())[0]
    const voice = this.voices.get(voiceId)
    const startTime = Date.now()

    // If native binary or python piper is available and model file exists
    const canExecute =
      (this.engineType === 'executable' || this.engineType === 'python') &&
      this.executablePath &&
      voice &&
      existsSync(voice.modelPath)

    if (canExecute) {
      try {
        const audioBuffer = await this.synthesizeWithExecutable(text, voice!, request)
        const durationMs = Date.now() - startTime
        return {
          audioBase64: audioBuffer.toString('base64'),
          mimeType: 'audio/wav',
          sampleRate: voice?.sampleRate || 22050,
          durationMs,
          voiceId: voice?.id || voiceId,
          isFallback: false
        }
      } catch (execErr) {
        console.warn(
          `[PiperManager] Synthesis failed (${execErr}), falling back to standard audio stream.`
        )
      }
    }

    // Fallback synthesis (Valid WAV audio stream for dev/testing)
    const sampleRate = voice?.sampleRate || 22050
    const estimatedDurationSec = Math.max(0.3, text.length * 0.06)
    const wavBuffer = createFallbackWavBuffer(sampleRate, estimatedDurationSec)
    const durationMs = Date.now() - startTime

    return {
      audioBase64: wavBuffer.toString('base64'),
      mimeType: 'audio/wav',
      sampleRate,
      durationMs,
      voiceId: voiceId || 'vi_VN-vivos-x_low',
      isFallback: true
    }
  }

  /**
   * Execute synthesis using piper CLI child_process
   */
  private synthesizeWithExecutable(
    text: string,
    voice: PiperVoiceModelInfo,
    request: PiperSynthesizeRequest
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const tempOutputFile = join(
        tmpdir(),
        `piper_synth_${Date.now()}_${Math.random().toString(36).substring(7)}.wav`
      )

      const args: string[] = []
      if (this.engineType === 'python') {
        args.push('-m', 'piper')
      }
      args.push('--model', voice.modelPath, '--output_file', tempOutputFile)

      if (existsSync(voice.configPath)) {
        args.push('--config', voice.configPath)
      }

      if (request.rate && request.rate > 0) {
        // length_scale in Piper is inverse of speed: 0.5 = 2x faster, 2.0 = 2x slower
        const lengthScale = 1.0 / request.rate
        args.push('--length_scale', lengthScale.toFixed(2))
      }

      if (request.noiseScale !== undefined) {
        args.push('--noise_scale', request.noiseScale.toString())
      }

      if (request.noiseW !== undefined) {
        args.push('--noise_w', request.noiseW.toString())
      }

      if (request.speakerId !== undefined) {
        args.push('--speaker', request.speakerId.toString())
      }

      const spawnCmd = this.executablePath || (this.engineType === 'python' ? 'python' : 'piper')
      const child = spawn(spawnCmd, args, {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1'
        }
      })

      let stderrMsg = ''

      child.stderr?.on('data', (data: Buffer) => {
        stderrMsg += data.toString()
      })

      child.on('error', (err) => {
        if (existsSync(tempOutputFile)) {
          try {
            unlinkSync(tempOutputFile)
          } catch {
            // Ignore
          }
        }
        reject(new Error(`Failed to spawn Piper process: ${err.message}`))
      })

      child.on('close', (code) => {
        if (code !== 0) {
          if (existsSync(tempOutputFile)) {
            try {
              unlinkSync(tempOutputFile)
            } catch {
              // Ignore
            }
          }
          reject(
            new Error(
              `Piper process exited with code ${code}. Stderr: ${stderrMsg.trim() || 'none'}`
            )
          )
        } else {
          try {
            if (existsSync(tempOutputFile)) {
              const fullBuffer = readFileSync(tempOutputFile)
              try {
                unlinkSync(tempOutputFile)
              } catch {
                // Ignore
              }
              if (fullBuffer.length === 0) {
                reject(new Error('Piper produced empty audio output.'))
              } else {
                resolve(fullBuffer)
              }
            } else {
              reject(new Error('Piper output file was not generated.'))
            }
          } catch (readErr) {
            reject(readErr)
          }
        }
      })

      // Send text to piper through stdin
      child.stdin.write(text, 'utf-8')
      child.stdin.end()
    })
  }

  public getVoices(): PiperVoiceModelInfo[] {
    return Array.from(this.voices.values())
  }

  public setActiveVoice(voiceId: string): boolean {
    if (this.voices.has(voiceId)) {
      this.activeVoiceId = voiceId
      return true
    }
    return false
  }

  public getStatus(): PiperStatusDTO {
    const activeVoice = this.activeVoiceId ? this.voices.get(this.activeVoiceId) : null
    return {
      isAvailable: this.isAvailable,
      engineType: this.engineType,
      activeVoiceId: this.activeVoiceId,
      activeVoiceName: activeVoice ? activeVoice.name : null,
      voices: this.getVoices(),
      executablePath: this.executablePath,
      modelDirectory: this.options.modelsDir || null,
      error: this.initializationError
    }
  }
}
