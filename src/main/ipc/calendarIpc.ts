import { ipcMain } from 'electron'
import { AgentCommandRequest, AgentOrchestrator } from '../agent/agentOrchestrator'
import { EventQuery, ICalendarService } from '../calendar/types'

export function registerCalendarIpc(
  orchestrator: AgentOrchestrator,
  calendarService: ICalendarService
): void {
  // Execute text command
  ipcMain.handle('agent:execute-command', async (_, request: AgentCommandRequest) => {
    if (!request || typeof request.text !== 'string') {
      return {
        success: false,
        intent: 'INVALID_REQUEST',
        message: 'Dữ liệu yêu cầu không hợp lệ.'
      }
    }
    return await orchestrator.processCommand(request)
  })

  // Get Calendar / Mode status
  ipcMain.handle('calendar:get-status', async () => {
    return await calendarService.getServiceStatus()
  })

  // Direct list events
  ipcMain.handle('calendar:list-events', async (_, query?: EventQuery) => {
    return await calendarService.listEvents(query)
  })
}
