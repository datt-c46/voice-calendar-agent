import { ElectronAPI } from '@electron-toolkit/preload'
import type { CalendarAgentAPI } from '../shared/ipc'

export type * from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: CalendarAgentAPI
  }
}
