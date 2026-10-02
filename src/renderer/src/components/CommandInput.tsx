import React, { useState } from 'react'

interface CommandInputProps {
  onSendCommand: (text: string) => void
  isProcessing: boolean
}

export const CommandInput: React.FC<CommandInputProps> = ({ onSendCommand, isProcessing }) => {
  const [text, setText] = useState('')

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!text.trim() || isProcessing) return
    onSendCommand(text.trim())
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <footer className="input-footer">
      <form onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <input
            type="text"
            className="command-input"
            placeholder="Nhập lệnh tự nhiên (ví dụ: Chiều mai lúc 3 giờ họp với A)..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing}
            autoFocus
          />
          <button type="submit" className="send-btn" disabled={!text.trim() || isProcessing}>
            {isProcessing ? 'Đang gửi...' : 'Gửi ↵'}
          </button>
        </div>
      </form>
      <div className="input-hints">
        <span>Gõ lệnh tự nhiên bằng tiếng Việt hoặc tiếng Anh</span>
        <span>Phím tắt: [Enter] để gửi</span>
      </div>
    </footer>
  )
}
