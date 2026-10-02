import React from 'react'

interface CommandSuggestionsProps {
  onSelectSuggestion: (text: string) => void
  disabled?: boolean
}

export const CommandSuggestions: React.FC<CommandSuggestionsProps> = ({
  onSelectSuggestion,
  disabled
}) => {
  const suggestions = [
    { label: '📅 Ngày mai tôi có lịch gì?', command: 'Ngày mai tôi có lịch gì?' },
    { label: '➕ Chiều mai lúc 3 giờ họp với A', command: 'Chiều mai lúc 3 giờ họp với A' },
    {
      label: '✏️ Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ',
      command: 'Dời cuộc họp lúc 3 giờ chiều ngày mai sang 4 giờ'
    },
    {
      label: '🗑️ Xóa cuộc họp lúc 3 giờ chiều ngày mai',
      command: 'Xóa cuộc họp lúc 3 giờ chiều ngày mai'
    },
    { label: '📅 What do I have tomorrow?', command: 'What do I have tomorrow?' }
  ]

  return (
    <div className="suggestions-container">
      {suggestions.map((item, idx) => (
        <button
          key={idx}
          className="suggestion-chip"
          disabled={disabled}
          onClick={() => onSelectSuggestion(item.command)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
