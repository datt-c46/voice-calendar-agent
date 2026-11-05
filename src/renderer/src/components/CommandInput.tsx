import React, { useState } from 'react'

interface CommandInputProps {
  onSendCommand: (text: string) => void
  isProcessing: boolean
  /** Signed out: the agent cannot be reached. */
  disabled?: boolean
}

export const CommandInput: React.FC<CommandInputProps> = ({
  onSendCommand,
  isProcessing,
  disabled
}) => {
  const [text, setText] = useState('')

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!text.trim() || isProcessing || disabled) return
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
    <div className="input-footer">
      <form onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <input
            type="text"
            className="command-input"
            aria-label="Câu lệnh"
            placeholder={
              disabled
                ? 'Hãy đăng nhập để bắt đầu…'
                : 'Nhập lệnh, ví dụ: Chiều mai lúc 3 giờ họp với A'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing || disabled}
            autoFocus
          />
          <button
            type="submit"
            className="btn btn-primary send-btn"
            disabled={!text.trim() || isProcessing || disabled}
          >
            {isProcessing ? 'Đang gửi…' : 'Gửi'}
          </button>
        </div>
      </form>
      <div className="input-hints">
        <span>Gõ lệnh tự nhiên bằng tiếng Việt hoặc tiếng Anh</span>
        <span>
          <kbd>Enter</kbd> để gửi
        </span>
      </div>
    </div>
  )
}
