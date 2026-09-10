import { AppVersions, AppVersionsTrack, IAppVersionsDbComponent } from '../../src/adapters/app-versions-db'
import { CURRENT_TRACK, LEGACY_TRACK } from '../../src/logic/app-version-tracks'

export function createTestAppVersions(overrides: Partial<AppVersions> = {}): AppVersions {
  return {
    ios: { minimalRequiredVersionNumber: 6300, recommendedVersionNumber: 6300 },
    android: { minimalRequiredVersionNumber: 6300, recommendedVersionNumber: 6500 },
    ...overrides
  }
}

export const DEFAULT_TEST_TRACKS: AppVersionsTrack[] = [
  { track: LEGACY_TRACK, ...createTestAppVersions(), updatedAt: '2026-09-10T00:00:00.000Z', updatedBy: null },
  { track: CURRENT_TRACK, ...createTestAppVersions(), updatedAt: '2026-09-10T00:00:00.000Z', updatedBy: null }
]

export function createAppVersionsDbJestMockComponent(
  overrides: Partial<jest.Mocked<IAppVersionsDbComponent>> = {}
): jest.Mocked<IAppVersionsDbComponent> {
  const known = new Set([LEGACY_TRACK, CURRENT_TRACK])
  return {
    get: jest.fn().mockImplementation((track: string) =>
      Promise.resolve(known.has(track) ? createTestAppVersions() : null)
    ),
    getAll: jest.fn().mockResolvedValue([...DEFAULT_TEST_TRACKS]),
    update: jest.fn().mockImplementation((track: string, values: AppVersions) =>
      Promise.resolve(known.has(track) ? values : null)
    ),
    ...overrides
  }
}
