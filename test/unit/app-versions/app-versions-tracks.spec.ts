import {
  getAppVersionsHandler,
  getAppVersionsByTrackHandler
} from '../../../src/controllers/handlers/app-versions/get-app-versions-handler'
import { updateAppVersionsHandler } from '../../../src/controllers/handlers/backoffice/app-versions/update-app-versions-handler'
import { createAppVersionsDbJestMockComponent, createTestAppVersions } from '../../mocks/app-versions-db-mock'
import { createLogsMockComponent } from '../../mocks/logs-mock'
import { createConfigJestMockComponent } from '../../mocks/config-mock'
import { CURRENT_TRACK, LEGACY_TRACK, LEGACY_MINIMAL_VERSION_CAP } from '../../../src/logic/app-version-tracks'

describe('app-versions tracks', () => {
  const ALLOWED_ADDRESS = '0xABCDEF1234567890123456789012345678901234'

  let mockAppVersionsDb: ReturnType<typeof createAppVersionsDbJestMockComponent>
  let mockLogs: ReturnType<typeof createLogsMockComponent>
  let mockConfig: ReturnType<typeof createConfigJestMockComponent>

  beforeEach(() => {
    mockAppVersionsDb = createAppVersionsDbJestMockComponent()
    mockLogs = createLogsMockComponent()
    mockConfig = createConfigJestMockComponent({ ALLOWED_USERS: ALLOWED_ADDRESS })
  })

  function readContext(track?: string) {
    return {
      components: { appVersionsDb: mockAppVersionsDb, logs: mockLogs },
      params: { track }
    }
  }

  function writeContext(body: any) {
    return {
      components: { appVersionsDb: mockAppVersionsDb, logs: mockLogs, config: mockConfig },
      verification: { auth: ALLOWED_ADDRESS },
      request: { json: () => Promise.resolve(body) }
    }
  }

  describe('reading', () => {
    it('should pin the bare endpoint to the legacy track, which old clients depend on', async () => {
      const response = await getAppVersionsHandler(readContext() as any)

      expect(response.status).toBe(200)
      expect(mockAppVersionsDb.get).toHaveBeenCalledWith(LEGACY_TRACK)
    })

    it('should serve the requested track', async () => {
      const response = await getAppVersionsByTrackHandler(readContext(CURRENT_TRACK) as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: createTestAppVersions() })
      expect(mockAppVersionsDb.get).toHaveBeenCalledWith(CURRENT_TRACK)
    })

    it('should 404 an unknown track so the client gate fails open', async () => {
      const response = await getAppVersionsByTrackHandler(readContext('nope') as any)

      expect(response.status).toBe(404)
    })

    it('should reject a track name that is not kebab-case', async () => {
      const response = await getAppVersionsByTrackHandler(readContext('Not A Track') as any)

      expect(response.status).toBe(400)
      expect(mockAppVersionsDb.get).not.toHaveBeenCalled()
    })
  })

  describe('writing', () => {
    const versions = createTestAppVersions()

    it('should default to the legacy track when no track is given', async () => {
      const response = await updateAppVersionsHandler(writeContext(versions) as any)

      expect(response.status).toBe(200)
      expect(mockAppVersionsDb.update).toHaveBeenCalledWith(LEGACY_TRACK, versions, ALLOWED_ADDRESS)
    })

    it('should write the explicitly requested track', async () => {
      const body = { track: CURRENT_TRACK, ...versions }
      const response = await updateAppVersionsHandler(writeContext(body) as any)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, data: { track: CURRENT_TRACK, ...versions } })
      expect(mockAppVersionsDb.update).toHaveBeenCalledWith(CURRENT_TRACK, versions, ALLOWED_ADDRESS)
    })

    it('should refuse a legacy minimum that would hard-gate a client that cannot render the overlay', async () => {
      const body = {
        ...versions,
        ios: { minimalRequiredVersionNumber: 101400, recommendedVersionNumber: 101400 }
      }
      const response = await updateAppVersionsHandler(writeContext(body) as any)

      expect(response.status).toBe(400)
      expect((response.body as any).error).toContain(String(LEGACY_MINIMAL_VERSION_CAP))
      expect(mockAppVersionsDb.update).not.toHaveBeenCalled()
    })

    it('should allow that same minimum on the current track', async () => {
      const body = {
        track: CURRENT_TRACK,
        ...versions,
        ios: { minimalRequiredVersionNumber: 101400, recommendedVersionNumber: 101400 }
      }
      const response = await updateAppVersionsHandler(writeContext(body) as any)

      expect(response.status).toBe(200)
    })

    it('should keep raising the legacy recommended version available, since soft gates still work', async () => {
      const body = {
        ...versions,
        ios: { minimalRequiredVersionNumber: 6300, recommendedVersionNumber: 101400 }
      }
      const response = await updateAppVersionsHandler(writeContext(body) as any)

      expect(response.status).toBe(200)
    })
  })
})
