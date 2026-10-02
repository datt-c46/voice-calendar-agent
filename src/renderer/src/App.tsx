import React, { useEffect, useState } from 'react'
import { ChatFeed, ChatMessage } from './components/ChatFeed'
import { CommandInput } from './components/CommandInput'
import { CommandSuggestions } from './components/CommandSuggestions'
import { AuthState, Header } from './components/Header'
import { MicrophoneControl } from './components/MicrophoneControl'
import { AgentExecutionResult } from './hooks/useVoiceActivity'
import { defaultTtsService } from './services/tts/ttsService'
import { formatAgentResponse } from './services/tts/responseFormatter'
import { createMockResponseStream } from './services/streaming'

function formatCurrentTime(): string {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  return formatter.format(now)
}

export function App(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      sender: 'assistant',
      text: 'Xin chào! Tôi là Trợ lý Lịch trình (Voice Calendar Agent).\n\nỨng dụng hỗ trợ cả giọng nói (VAD + STT + TTS) và Google Calendar thật lẫn Mock Mode ngoại tuyến. Bạn có thể nói hoặc nhập các câu lệnh bên dưới:',
      timestamp: formatCurrentTime()
    }
  ])

  const [status, setStatus] = useState<{
    mode: string
    connected: boolean
    timeZone: string
    eventCount: number
  }>({
    mode: 'mock',
    connected: true,
    timeZone: 'Asia/Bangkok',
    eventCount: 4
  })

  const [authState, setAuthState] = useState<AuthState>('NOT_CONFIGURED')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | undefined>(undefined)
  const [isProcessing, setIsProcessing] = useState(false)

  // Fetch initial calendar status and Google auth status
  useEffect(() => {
    async function loadInitialState(): Promise<void> {
      try {
        if (window.api) {
          // Check auth status
          if (window.api.getAuthStatus) {
            const authRes = await window.api.getAuthStatus()
            if (!authRes.isConfigured) {
              setAuthState('NOT_CONFIGURED')
            } else if (authRes.isAuthenticated) {
              setAuthState('CONNECTED')
              setUserEmail(authRes.userEmail || null)
            } else {
              setAuthState('DISCONNECTED')
            }
          }

          // Check calendar status
          if (window.api.getCalendarStatus) {
            const calRes = await window.api.getCalendarStatus()
            setStatus({
              mode: calRes.mode,
              connected: calRes.connected,
              timeZone: calRes.timeZone,
              eventCount: calRes.eventCount || 0
            })
          }
        }
      } catch (err) {
        console.error('Failed to load initial status:', err)
      }
    }
    loadInitialState()
  }, [])

  const handleConnect = async (): Promise<void> => {
    setAuthState('AUTHENTICATING')
    setAuthError(undefined)

    try {
      if (window.api && window.api.startGoogleAuth) {
        const res = await window.api.startGoogleAuth()
        if (res.isAuthenticated) {
          setAuthState('CONNECTED')
          setUserEmail(res.userEmail || null)

          // Refresh calendar status
          if (window.api.getCalendarStatus) {
            const calRes = await window.api.getCalendarStatus()
            setStatus({
              mode: calRes.mode,
              connected: calRes.connected,
              timeZone: calRes.timeZone,
              eventCount: calRes.eventCount || 0
            })
          }

          setMessages((prev) => [
            ...prev,
            {
              id: `asst-auth-${Date.now()}`,
              sender: 'assistant',
              text: `✅ Đã kết nối thành công với tài khoản Google Calendar: ${res.userEmail || ''}! Các lệnh tiếp theo sẽ đồng bộ trực tiếp với Google Calendar thật.`,
              timestamp: formatCurrentTime()
            }
          ])
        } else {
          setAuthState('DISCONNECTED')
          if (res.error) {
            setAuthError(res.error)
            setMessages((prev) => [
              ...prev,
              {
                id: `asst-auth-err-${Date.now()}`,
                sender: 'assistant',
                text: `Chưa thể hoàn tất đăng nhập Google: ${res.error}. Ứng dụng tiếp tục sử dụng Mock Calendar.`,
                timestamp: formatCurrentTime()
              }
            ])
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setAuthState('ERROR')
      setAuthError(errMsg)
      setMessages((prev) => [
        ...prev,
        {
          id: `asst-auth-err-${Date.now()}`,
          sender: 'assistant',
          text: `⚠️ Lỗi xác thực: ${errMsg}. Ứng dụng vẫn hoạt động bình thường với Mock Calendar.`,
          timestamp: formatCurrentTime()
        }
      ])
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    try {
      if (window.api && window.api.logoutGoogle) {
        await window.api.logoutGoogle()
        setAuthState('DISCONNECTED')
        setUserEmail(null)
        setAuthError(undefined)

        // Refresh calendar status to switch back to mock
        if (window.api.getCalendarStatus) {
          const calRes = await window.api.getCalendarStatus()
          setStatus({
            mode: calRes.mode,
            connected: calRes.connected,
            timeZone: calRes.timeZone,
            eventCount: calRes.eventCount || 0
          })
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `asst-auth-logout-${Date.now()}`,
            sender: 'assistant',
            text: 'Đã ngắt kết nối tài khoản Google Calendar. Ứng dụng đã chuyển về chế độ Mock Calendar.',
            timestamp: formatCurrentTime()
          }
        ])
      }
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  const handleSendCommand = async (text: string): Promise<AgentExecutionResult | undefined> => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: formatCurrentTime()
    }

    setMessages((prev) => [...prev, userMsg])
    setIsProcessing(true)

    try {
      if (window.api && window.api.executeCommand) {
        const response = await window.api.executeCommand({
          text,
          clientTimestamp: new Date().toISOString(),
          timeZone: status.timeZone
        })

        const assistantMsg: ChatMessage = {
          id: `asst-${Date.now()}`,
          sender: 'assistant',
          text: response.message,
          intent: response.intent,
          timestamp: formatCurrentTime(),
          events: response.events
        }

        setMessages((prev) => [...prev, assistantMsg])

        // Trigger Piper Neural TTS playback
        if (response.message) {
          try {
            const formatted = formatAgentResponse(response.message)
            const stream = createMockResponseStream(formatted.ttsText || response.message, { chunkDelayMs: 20 })
            void defaultTtsService.speakStream(stream)
          } catch (ttsErr) {
            console.warn('[App] TTS playback error:', ttsErr)
          }
        }

        // Refresh status to update eventCount safely
        try {
          const updatedStatus = await window.api.getCalendarStatus()
          if (updatedStatus) {
            setStatus((prev) => ({
              ...prev,
              mode: updatedStatus.mode,
              eventCount: updatedStatus.eventCount || prev.eventCount
            }))
          }
        } catch (statusErr) {
          console.warn('Failed to refresh calendar status:', statusErr)
        }

        return response
      } else {
        const fallbackMsg: ChatMessage = {
          id: `asst-${Date.now()}`,
          sender: 'assistant',
          text: 'Lỗi: window.api chưa được khởi tạo qua Preload.',
          timestamp: formatCurrentTime()
        }
        setMessages((prev) => [...prev, fallbackMsg])
        return {
          success: false,
          intent: 'ERROR',
          message: 'Lỗi: window.api chưa được khởi tạo qua Preload.'
        }
      }
    } catch (err) {
      const errMsg: ChatMessage = {
        id: `asst-err-${Date.now()}`,
        sender: 'assistant',
        text: `Đã xảy ra lỗi khi gửi yêu cầu: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: formatCurrentTime()
      }
      setMessages((prev) => [...prev, errMsg])
      return {
        success: false,
        intent: 'ERROR',
        message: `Đã xảy ra lỗi khi gửi yêu cầu: ${err instanceof Error ? err.message : String(err)}`
      }
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="app-container">
      <Header
        authError={authError}
        authState={authState}
        eventCount={status.eventCount}
        mode={status.mode}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        timeZone={status.timeZone}
        userEmail={userEmail}
      />

      <ChatFeed isProcessing={isProcessing} messages={messages} />

      <CommandSuggestions disabled={isProcessing} onSelectSuggestion={handleSendCommand} />

      <MicrophoneControl onVoiceCommand={handleSendCommand} />

      <CommandInput isProcessing={isProcessing} onSendCommand={handleSendCommand} />
    </div>
  )
}

export default App
