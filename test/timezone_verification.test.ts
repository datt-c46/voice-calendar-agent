import assert from 'assert'
import { calendar_v3 } from 'googleapis'
import { DateTime } from 'luxon'
import { AgentOrchestrator } from '../src/main/agent/agentOrchestrator'
import { DateTimeService } from '../src/main/agent/dateTimeService'
import { RuleBasedIntentExtractor } from '../src/main/agent/ruleBasedExtractor'
import { GoogleCalendarService } from '../src/main/calendar/googleCalendarService'
import { MockCalendarService } from '../src/main/calendar/mockCalendarService'
import { APP_TIMEZONE, CreateEventInput } from '../src/main/calendar/types'

async function runTimezoneTests(): Promise<void> {
  console.log('====================================================')
  console.log('STARTING TIMEZONE FIX VERIFICATION SUITE')
  console.log('Application Policy Timezone:', APP_TIMEZONE)
  console.log('====================================================\n')

  const dtService = new DateTimeService()
  const extractor = new RuleBasedIntentExtractor(dtService)

  // Anchor test to a known fixed reference point in Asia/Bangkok for deterministic inspection:
  // e.g., 2026-10-02T10:00:00.000+07:00
  const refBangkokNow = DateTime.fromISO('2026-10-02T10:00:00.000+07:00', { zone: APP_TIMEZONE })

  // ----------------------------------------------------
  // TEST 1: Focused stage-by-stage test for:
  // "Chiều mai lúc 3 giờ họp với A"
  // ----------------------------------------------------
  console.log('[Test 1] Detailed stage-by-stage analysis:')
  const query1 = 'Chiều mai lúc 3 giờ họp với A'
  console.log('  1. User Text:', query1)

  const parsedTemporal1 = dtService.parseTemporalExpression(query1, refBangkokNow)
  assert.ok(parsedTemporal1 !== null, 'Temporal info should be parsed')

  const extractedDt = DateTime.fromISO(parsedTemporal1.startDateTime, { zone: APP_TIMEZONE })
  console.log('  2. Extracted Date:', extractedDt.toFormat('yyyy-MM-dd'))
  console.log('  3. Extracted Hour/Minute:', extractedDt.toFormat('HH:mm'))
  console.log('  4. Luxon DateTime Zone:', extractedDt.zoneName)
  console.log('  5. Serialized DateTime (startDateTime):', parsedTemporal1.startDateTime)
  console.log('  6. Serialized DateTime (endDateTime):', parsedTemporal1.endDateTime)

  assert.strictEqual(extractedDt.hour, 15, 'Hour must be 15 (3 PM)')
  assert.strictEqual(extractedDt.minute, 0, 'Minute must be 0')
  assert.strictEqual(extractedDt.zoneName, APP_TIMEZONE, 'Zone must be Asia/Bangkok')
  assert.strictEqual(parsedTemporal1.timeZone, APP_TIMEZONE, 'timeZone field must be Asia/Bangkok')
  assert.ok(parsedTemporal1.startDateTime.includes('+07:00'), 'Must contain explicit +07:00 offset')

  // Now test Google Calendar API payload generation
  let capturedInsertBody: calendar_v3.Schema$Event | null = null
  const dummyOAuth = {
    isConfigured: () => true,
    getAuthStatus: async () => ({
      isAuthenticated: true,
      isConfigured: true,
      userEmail: 'test@example.com',
      scopes: []
    }),
    getAuthenticatedClient: async () => null
  } as unknown as import('../src/main/auth/oauthManager').OAuthManager
  const googleCalendarService = new GoogleCalendarService(dummyOAuth)
  // Inject mock calendar client to capture exact requestBody sent to Google API
  ;(googleCalendarService as unknown as Record<string, unknown>).getCalendarClient = async () => ({
    events: {
      insert: async ({ requestBody }: { requestBody: calendar_v3.Schema$Event }) => {
        capturedInsertBody = requestBody
        return {
          data: {
            id: 'mock-google-id-123',
            ...requestBody,
            status: 'confirmed'
          }
        }
      },
      list: async () => ({ data: { items: [] } })
    }
  })

  const mockCalendar = new MockCalendarService()
  const orchestrator = new AgentOrchestrator(mockCalendar)
  // Mock extractor inside orchestrator with our reference time
  const extIntent = extractor.extract(query1)
  // Re-verify orchestrator createEvent input and Google Calendar payload
  const createInput: CreateEventInput = {
    summary: extIntent.summary || 'Cuộc hẹn mới',
    startDateTime: parsedTemporal1.startDateTime,
    endDateTime: parsedTemporal1.endDateTime,
    timeZone: APP_TIMEZONE
  }

  const createdGoogleEvent = await googleCalendarService.createEvent(createInput)
  console.log(
    '  7. Final Google Calendar API Payload:',
    JSON.stringify(capturedInsertBody, null, 2)
  )

  const insertBody = capturedInsertBody as unknown as calendar_v3.Schema$Event
  assert.strictEqual(insertBody?.start?.dateTime, parsedTemporal1.startDateTime)
  assert.strictEqual(insertBody?.start?.timeZone, APP_TIMEZONE)
  assert.strictEqual(insertBody?.end?.timeZone, APP_TIMEZONE)
  assert.strictEqual(createdGoogleEvent.start.dateTime, parsedTemporal1.startDateTime)
  assert.strictEqual(createdGoogleEvent.start.timeZone, APP_TIMEZONE)
  console.log('  ✓ Stage-by-stage verification for "Chiều mai lúc 3 giờ họp với A" passed!\n')

  // ----------------------------------------------------
  // TEST 2: "sáng mai lúc 9 giờ"
  // ----------------------------------------------------
  console.log('[Test 2] Query: "sáng mai lúc 9 giờ"')
  const query2 = 'sáng mai lúc 9 giờ'
  const parsed2 = dtService.parseTemporalExpression(query2, refBangkokNow)
  assert.ok(parsed2 !== null)
  const dt2 = DateTime.fromISO(parsed2.startDateTime, { zone: APP_TIMEZONE })
  console.log('  Extracted:', dt2.toFormat('yyyy-MM-dd HH:mm'), dt2.zoneName, parsed2.startDateTime)
  assert.strictEqual(dt2.hour, 9, 'Must be 09:00')
  assert.strictEqual(dt2.minute, 0)
  assert.strictEqual(dt2.zoneName, APP_TIMEZONE)
  assert.ok(parsed2.startDateTime.includes('+07:00'))
  console.log('  ✓ "sáng mai lúc 9 giờ" -> 09:00 Asia/Bangkok (+07:00) verified!\n')

  // ----------------------------------------------------
  // TEST 3: "tối mai lúc 8 giờ"
  // ----------------------------------------------------
  console.log('[Test 3] Query: "tối mai lúc 8 giờ"')
  const query3 = 'tối mai lúc 8 giờ'
  const parsed3 = dtService.parseTemporalExpression(query3, refBangkokNow)
  assert.ok(parsed3 !== null)
  const dt3 = DateTime.fromISO(parsed3.startDateTime, { zone: APP_TIMEZONE })
  console.log('  Extracted:', dt3.toFormat('yyyy-MM-dd HH:mm'), dt3.zoneName, parsed3.startDateTime)
  assert.strictEqual(dt3.hour, 20, 'Must be 20:00 (8 PM)')
  assert.strictEqual(dt3.minute, 0)
  assert.strictEqual(dt3.zoneName, APP_TIMEZONE)
  assert.ok(parsed3.startDateTime.includes('+07:00'))
  console.log('  ✓ "tối mai lúc 8 giờ" -> 20:00 Asia/Bangkok (+07:00) verified!\n')

  // ----------------------------------------------------
  // TEST 4: "15h ngày mai"
  // ----------------------------------------------------
  console.log('[Test 4] Query: "15h ngày mai"')
  const query4 = '15h ngày mai'
  const parsed4 = dtService.parseTemporalExpression(query4, refBangkokNow)
  assert.ok(parsed4 !== null)
  const dt4 = DateTime.fromISO(parsed4.startDateTime, { zone: APP_TIMEZONE })
  console.log('  Extracted:', dt4.toFormat('yyyy-MM-dd HH:mm'), dt4.zoneName, parsed4.startDateTime)
  assert.strictEqual(dt4.hour, 15, 'Must be 15:00')
  assert.strictEqual(dt4.minute, 0)
  assert.strictEqual(dt4.zoneName, APP_TIMEZONE)
  assert.ok(parsed4.startDateTime.includes('+07:00'))
  console.log('  ✓ "15h ngày mai" -> 15:00 Asia/Bangkok (+07:00) verified!\n')

  // ----------------------------------------------------
  // TEST 5: Orchestrator integration test with full command
  // ----------------------------------------------------
  console.log('[Test 5] Orchestrator processCommand end-to-end:')
  const res = await orchestrator.processCommand({
    text: 'Chiều mai lúc 3 giờ họp với A'
  })
  assert.strictEqual(res.success, true)
  assert.strictEqual(res.intent, 'CREATE_EVENT')
  assert.strictEqual(res.events?.[0]?.summary, 'Họp với A')
  const firstEvent = res.events ? res.events[0] : undefined
  assert.ok(firstEvent, 'Event must exist')
  const createdStart = firstEvent.start.dateTime
  assert.ok(createdStart.includes('+07:00'), 'Must contain +07:00 offset')
  const createdDt = DateTime.fromISO(createdStart, { zone: APP_TIMEZONE })
  assert.strictEqual(createdDt.hour, 15)
  console.log('  ✓ Orchestrator successfully scheduled event at 15:00 Asia/Bangkok\n')

  console.log('====================================================')
  console.log('ALL TIMEZONE VERIFICATION TESTS COMPLETED SUCCESSFULLY!')
  console.log('====================================================')
}

runTimezoneTests().catch((err) => {
  console.error('Timezone test suite failed:', err)
  process.exit(1)
})
