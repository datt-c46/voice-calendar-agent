/** Short Vietnamese labels for the agent intents shown next to an answer ('Tạo lịch · 12:15'). */
const INTENT_LABELS = new Map<string, string>([
  ['LIST_EVENTS', 'Xem lịch'],
  ['CREATE_EVENT', 'Tạo lịch'],
  ['UPDATE_EVENT', 'Sửa lịch'],
  ['DELETE_EVENT', 'Xóa lịch'],
  ['CHECK_AVAILABILITY', 'Kiểm tra lịch trống'],
  ['CONFIRM_ACTION', 'Đã xác nhận'],
  ['REJECT_ACTION', 'Đã hủy'],
  ['UNKNOWN', 'Chưa rõ yêu cầu'],
  ['ERROR', 'Lỗi']
])

/** Human-readable label for an agent intent; an unknown one becomes 'Some new intent' rather than 'SOME_NEW_INTENT'. */
export function intentLabel(intent: string): string {
  const known = INTENT_LABELS.get(intent)
  if (known) return known
  const words = intent.replace(/_+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : intent
}
