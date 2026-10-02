import { OAuthManager } from '../auth/oauthManager'
import { GoogleCalendarService } from './googleCalendarService'
import { MockCalendarService } from './mockCalendarService'
import {
  CalendarEvent,
  CalendarStatus,
  CreateEventInput,
  EventQuery,
  ICalendarService,
  UpdateEventInput
} from './types'

export class CalendarManager implements ICalendarService {
  private mockService: MockCalendarService
  private googleService: GoogleCalendarService
  private oauthManager: OAuthManager

  constructor(oauthManager: OAuthManager) {
    this.oauthManager = oauthManager
    this.mockService = new MockCalendarService()
    this.googleService = new GoogleCalendarService(oauthManager)
  }

  public async initialize(): Promise<void> {
    await this.mockService.initialize()
    await this.googleService.initialize()
  }

  /**
   * Resolves the active calendar service.
   * If Google OAuth is configured and user is authenticated -> GoogleCalendarService.
   * Otherwise -> MockCalendarService.
   */
  public async getActiveService(): Promise<ICalendarService> {
    if (this.oauthManager.isConfigured()) {
      const client = await this.oauthManager.getAuthenticatedClient()
      if (client) {
        return this.googleService
      }
    }
    return this.mockService
  }

  public async getServiceStatus(): Promise<CalendarStatus> {
    const active = await this.getActiveService()
    return await active.getServiceStatus()
  }

  public async listEvents(query?: EventQuery): Promise<CalendarEvent[]> {
    const active = await this.getActiveService()
    return await active.listEvents(query)
  }

  public async getEvent(eventId: string): Promise<CalendarEvent | null> {
    const active = await this.getActiveService()
    return await active.getEvent(eventId)
  }

  public async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const active = await this.getActiveService()
    return await active.createEvent(input)
  }

  public async updateEvent(eventId: string, patch: UpdateEventInput): Promise<CalendarEvent> {
    const active = await this.getActiveService()
    return await active.updateEvent(eventId, patch)
  }

  public async deleteEvent(eventId: string): Promise<boolean> {
    const active = await this.getActiveService()
    return await active.deleteEvent(eventId)
  }
}
