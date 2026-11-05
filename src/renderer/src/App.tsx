import React, { useCallback, useEffect, useRef, useState } from 'react'
import { parseIpcError } from '../../shared/errors'
import type { AgentCommandResult, AuthStatusDTO, CalendarStatusDTO } from '../../shared/ipc'
import { ChatFeed, ChatMessage } from './components/ChatFeed'
import { CommandInput } from './components/CommandInput'
import { CommandSuggestions } from './components/CommandSuggestions'
import { Header } from './components/Header'
import { MicrophoneControl } from './components/MicrophoneControl'
import { AgentExecutionResult } from './hooks/useVoiceActivity'
import { defaultTtsService } from './services/tts/ttsService'
import { formatAgentResponse } from './services/tts/responseFormatter'
import { createMockResponseStream } from './services/streaming'

function formatCurrentTime(): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date())
}

let messageSeq = 0
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${++messageSeq}`

/** Reads the reply aloud through the TTS queue (voice-backend Piper, Web Speech as fallback). */
function speakReply(text: string): void {
  try {
    const formatted = formatAgentResponse(text)
    const stream = createMockResponseStream(formatted.ttsText || text, { chunkDelayMs: 20 })
    void defaultTtsService.speakStream(stream)
  } catch (ttsErr) {
    console.warn('[App] TTS playback error:', ttsErr)
  }
}

interface SendOptions {
  /** false when the voice pipeline (useVoiceActivity) speaks the answer itself. */
  speak?: boolean
  source?: 'text' | 'voice'
}

export function App(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      sender: 'assistant',
      text: 'Xin chào! Tôi là Trợ lý Lịch trình (Voice Calendar Agent).\n\nỨng dụng chạy trên voice-backend: đăng nhập bằng Google để dùng Google Calendar của bạn (tài khoản dev dùng lịch local trên server). Sau đó bạn có thể nói hoặc nhập các câu lệnh bên dưới:',
      timestamp: formatCurrentTime()
    }
  ])
  const [auth, setAuth] = useState<AuthStatusDTO | null>(null)
  const [calendar, setCalendar] = useState<CalendarStatusDTO | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  /** Sent with every command so "có"/"không" answers and follow-ups stay in the same backend conversation. */
  const conversationIdRef = useRef<string | undefined>(undefined)
  const signedInRef = useRef(false)

  const addAssistantMessage = useCallback((text: string): void => {
    setMessages((prev) => [
      ...prev,
      { id: nextId('asst'), sender: 'assistant', text, timestamp: formatCurrentTime() }
    ])
  }, [])

  const refreshCalendar = useCallback(async (): Promise<void> => {
    try {
      setCalendar(await window.api.getCalendarStatus())
    } catch (err) {
      console.warn('Failed to load calendar status:', parseIpcError(err).message)
      setCalendar(null)
    }
  }, [])

  const applyAuth = useCallback(
    (status: AuthStatusDTO): void => {
      setAuth(status)
      const wasSignedIn = signedInRef.current
      signedInRef.current = status.isAuthenticated
      if (status.isAuthenticated) {
        void refreshCalendar()
        // TTS fell back to Web Speech while signed out: switch to the server voice now.
        if (!wasSignedIn) void defaultTtsService.reinitialize()
      } else {
        setCalendar(null)
        conversationIdRef.current = undefined
      }
    },
    [refreshCalendar]
  )

  useEffect(() => {
    let cancelled = false
    window.api
      .getAuthStatus()
      .then((status) => {
        if (!cancelled) applyAuth(status)
      })
      .catch((err) => console.error('Failed to load auth status:', parseIpcError(err).message))
    // Sign-in / sign-out / session expiry pushed by the main process.
    const unsubscribe = window.api.onAuthChanged((status) => applyAuth(status))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [applyAuth])

  const runSignIn = async (signIn: () => Promise<AuthStatusDTO>): Promise<void> => {
    setSigningIn(true)
    try {
      const res = await signIn()
      applyAuth(res)
      if (res.error) {
        if (res.error !== 'SIGN_IN_CANCELLED')
          addAssistantMessage(`Chưa thể đăng nhập: ${res.errorMessage}`)
      } else if (res.isAuthenticated) {
        addAssistantMessage(
          res.calendarProvider === 'google'
            ? `✅ Đã đăng nhập ${res.userEmail ?? ''}. Các lệnh sẽ thao tác trực tiếp trên Google Calendar.`
            : `✅ Đã đăng nhập ${res.userEmail ?? ''}. Đang dùng lịch local trên server.`
        )
      }
    } catch (err) {
      addAssistantMessage(`⚠️ Lỗi đăng nhập: ${parseIpcError(err).message}`)
    } finally {
      setSigningIn(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    try {
      defaultTtsService.stop()
      applyAuth(await window.api.signOut())
      addAssistantMessage('Đã đăng xuất khỏi voice-backend.')
    } catch (err) {
      addAssistantMessage(`⚠️ Đăng xuất thất bại: ${parseIpcError(err).message}`)
    }
  }

  const handleDisconnectGoogle = async (): Promise<void> => {
    const res = await window.api.disconnectGoogle()
    applyAuth(res)
    addAssistantMessage(
      res.error
        ? `⚠️ Không ngắt được Google: ${res.errorMessage}`
        : 'Đã thu hồi quyền Google. Lịch chuyển sang lịch local trên server.'
    )
  }

  /** Appends an agent answer, keeps its conversation id and reacts to session/Google errors. */
  const handleAgentResult = useCallback(
    (response: AgentCommandResult, speak: boolean, resolvedActionId?: string): void => {
      if (response.conversationId) conversationIdRef.current = response.conversationId
      const pendingActionId =
        response.requiresConfirmation && response.pendingAction
          ? response.pendingAction.id
          : undefined
      // A yes/no answer (button, text or voice) settles every pending question shown so far.
      const settlesAll = response.intent === 'CONFIRM_ACTION' || response.intent === 'REJECT_ACTION'
      const settled = response.intent !== 'ERROR'

      setMessages((prev) => [
        ...prev.map((m) =>
          m.pendingActionId &&
          !m.actionResolved &&
          (settlesAll || (settled && m.pendingActionId === resolvedActionId))
            ? { ...m, actionResolved: true }
            : m
        ),
        {
          id: nextId('asst'),
          sender: 'assistant',
          text: response.message,
          intent: response.intent,
          timestamp: formatCurrentTime(),
          ...(response.events ? { events: response.events } : {}),
          ...(pendingActionId ? { pendingActionId } : {})
        }
      ])

      const code = response.error?.code
      if (code === 'UNAUTHORIZED') {
        void window.api.getAuthStatus().then(applyAuth)
      } else if (code === 'GOOGLE_REAUTH_REQUIRED') {
        void refreshCalendar()
      }
      if (speak && response.message) speakReply(response.message)
    },
    [applyAuth, refreshCalendar]
  )

  const handleSendCommand = useCallback(
    async (text: string, options: SendOptions = {}): Promise<AgentExecutionResult | undefined> => {
      const { speak = true, source = 'text' } = options
      setMessages((prev) => [
        ...prev,
        { id: nextId('user'), sender: 'user', text, timestamp: formatCurrentTime() }
      ])
      setIsProcessing(true)
      try {
        const conversationId = conversationIdRef.current
        const response = await window.api.executeCommand({
          text,
          source,
          ...(conversationId ? { conversationId } : {})
        })
        handleAgentResult(response, speak)
        return response
      } catch (err) {
        const { code, message } = parseIpcError(err)
        addAssistantMessage(`Đã xảy ra lỗi khi gửi yêu cầu: ${message}`)
        return {
          success: false,
          intent: 'ERROR',
          language: 'vi',
          message,
          error: { code: code ?? 'CLIENT_ERROR' }
        }
      } finally {
        setIsProcessing(false)
      }
    },
    [addAssistantMessage, handleAgentResult]
  )

  const handleVoiceCommand = useCallback(
    // useVoiceActivity speaks the answer itself: do not synthesize it twice.
    (text: string) => handleSendCommand(text, { speak: false, source: 'voice' }),
    [handleSendCommand]
  )

  const handlePendingAction = async (actionId: string, confirm: boolean): Promise<void> => {
    setIsProcessing(true)
    try {
      const response = confirm
        ? await window.api.confirmAction(actionId)
        : await window.api.rejectAction(actionId)
      handleAgentResult(response, true, actionId)
    } catch (err) {
      addAssistantMessage(`Đã xảy ra lỗi: ${parseIpcError(err).message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const signedIn = auth?.isAuthenticated === true

  return (
    <div className="app-container">
      <Header
        auth={auth}
        calendar={calendar}
        signingIn={signingIn}
        onSignInGoogle={() => void runSignIn(() => window.api.signInWithGoogle())}
        onSignInDev={() => void runSignIn(() => window.api.signInDev())}
        onCancelSignIn={() => void window.api.cancelSignIn()}
        onSignOut={() => void handleSignOut()}
        onDisconnectGoogle={() => void handleDisconnectGoogle()}
      />

      <ChatFeed
        isProcessing={isProcessing}
        messages={messages}
        onConfirmAction={(id) => void handlePendingAction(id, true)}
        onRejectAction={(id) => void handlePendingAction(id, false)}
      />

      <CommandSuggestions
        disabled={isProcessing || !signedIn}
        onSelectSuggestion={(text) => void handleSendCommand(text)}
      />

      <MicrophoneControl disabled={!signedIn} onVoiceCommand={handleVoiceCommand} />

      <CommandInput
        disabled={!signedIn}
        isProcessing={isProcessing}
        onSendCommand={(text) => void handleSendCommand(text)}
      />
    </div>
  )
}

export default App
