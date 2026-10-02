import { useCallback, useEffect, useRef, useState } from 'react'

export type MicrophoneStatus = 'idle' | 'requesting' | 'listening' | 'stopped' | 'error'

export interface UseMicrophoneReturn {
  status: MicrophoneStatus
  start: () => Promise<{ stream: MediaStream; audioContext: AudioContext } | null>
  stop: () => void
  audioLevel: number // Normalized 0 to 1
  error: string | null
}

export function useMicrophone(): UseMicrophoneReturn {
  const [status, setStatus] = useState<MicrophoneStatus>('idle')
  const [audioLevel, setAudioLevel] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number | null>(null)

  // Internal cleanup helper to release all audio & stream resources
  const cleanupResources = useCallback((): void => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch {
        // Disconnect can fail if context is already closing
      }
      sourceRef.current = null
    }

    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect()
      } catch {
        // Ignore disconnect errors
      }
      analyserRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // Ignore track stop error
        }
      })
      streamRef.current = null
    }

    if (audioCtxRef.current) {
      if (audioCtxRef.current.state !== 'closed') {
        try {
          audioCtxRef.current.close().catch(() => {
            // Ignore close error on unmount
          })
        } catch {
          // Ignore synchronous close error
        }
      }
      audioCtxRef.current = null
    }

    setAudioLevel(0)
  }, [])

  const start = useCallback(async (): Promise<{
    stream: MediaStream
    audioContext: AudioContext
  } | null> => {
    // Guard: Prevent double-start if already listening or requesting
    if (status === 'listening' || status === 'requesting') {
      return streamRef.current && audioCtxRef.current
        ? { stream: streamRef.current, audioContext: audioCtxRef.current }
        : null
    }

    setStatus('requesting')
    setError(null)

    // Ensure any previously lingering resources are cleanly released first
    cleanupResources()

    try {
      // 1. Request microphone permission and acquire stream
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          'Trình duyệt hoặc môi trường không hỗ trợ navigator.mediaDevices.getUserMedia.'
        )
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      streamRef.current = stream

      // 2. Initialize Web Audio Context
      const AudioCtxConstructor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext

      if (!AudioCtxConstructor) {
        throw new Error('Web Audio API (AudioContext) không được hỗ trợ trong môi trường này.')
      }

      const audioCtx = new AudioCtxConstructor()
      audioCtxRef.current = audioCtx

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }

      // 3. Create MediaStreamAudioSourceNode and AnalyserNode
      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.4
      analyserRef.current = analyser

      source.connect(analyser)

      // 4. Start real-time audio level monitoring
      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateLevel = (): void => {
        if (!analyserRef.current || status === 'stopped' || status === 'error') {
          return
        }

        analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const average = sum / dataArray.length
        // Normalize 0..255 to 0..1 with slight scaling so conversational voice registers clearly
        const normalized = Math.min(1, Math.max(0, average / 110))
        setAudioLevel(normalized)

        animFrameRef.current = requestAnimationFrame(updateLevel)
      }

      animFrameRef.current = requestAnimationFrame(updateLevel)
      setStatus('listening')

      return { stream, audioContext: audioCtx }
    } catch (err: unknown) {
      cleanupResources()
      setStatus('error')

      const errorObj = err as { name?: string; message?: string }
      if (errorObj?.name === 'NotAllowedError' || errorObj?.name === 'PermissionDeniedError') {
        setError('Quyền truy cập Microphone bị từ chối (Permission denied).')
      } else if (errorObj?.name === 'NotFoundError' || errorObj?.name === 'DevicesNotFoundError') {
        setError('Không tìm thấy thiết bị Microphone (No microphone found).')
      } else if (errorObj?.name === 'NotReadableError' || errorObj?.name === 'TrackStartError') {
        setError('Microphone đang được sử dụng bởi ứng dụng khác.')
      } else {
        setError(errorObj?.message || 'Không thể khởi động microphone.')
      }

      return null
    }
  }, [status, cleanupResources])

  const stop = useCallback((): void => {
    // Guard: Prevent double-stop if already stopped or idle
    if (status === 'stopped' || status === 'idle') {
      return
    }

    cleanupResources()
    setStatus('stopped')
  }, [status, cleanupResources])

  // Cleanup immediately when unmounting
  useEffect(() => {
    return (): void => {
      cleanupResources()
    }
  }, [cleanupResources])

  return {
    status,
    start,
    stop,
    audioLevel,
    error
  }
}
