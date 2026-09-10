import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { isAllowedUser } from '../../../../logic/allowed-users'
import { AppVersions, PlatformVersions } from '../../../../adapters/app-versions-db'
import { LEGACY_TRACK, isValidTrackName, validateTrackMinimal } from '../../../../logic/app-version-tracks'

type PlatformBody = {
  minimalRequiredVersionNumber?: unknown
  recommendedVersionNumber?: unknown
}

type UpdateBody = {
  track?: unknown
  ios?: PlatformBody
  android?: PlatformBody
}

function parsePlatform(input: PlatformBody | undefined, platform: string): PlatformVersions | string {
  if (!input || typeof input !== 'object') {
    return `Missing or invalid '${platform}' object`
  }
  const { minimalRequiredVersionNumber: min, recommendedVersionNumber: rec } = input

  if (!Number.isInteger(min) || (min as number) < 0) {
    return `'${platform}.minimalRequiredVersionNumber' must be a non-negative integer`
  }
  if (!Number.isInteger(rec) || (rec as number) < 0) {
    return `'${platform}.recommendedVersionNumber' must be a non-negative integer`
  }
  if ((rec as number) < (min as number)) {
    return `'${platform}.recommendedVersionNumber' must be >= minimalRequiredVersionNumber`
  }

  return {
    minimalRequiredVersionNumber: min as number,
    recommendedVersionNumber: rec as number
  }
}

export async function updateAppVersionsHandler(
  context: HandlerContextWithPath<'appVersionsDb' | 'logs' | 'config', '/backoffice/app-versions'>
    & DecentralandSignatureContext<any>
) {
  const {
    components: { appVersionsDb, logs, config },
    verification,
    request
  } = context

  const logger = logs.getLogger('update-app-versions')
  const userAddress = verification?.auth

  if (!userAddress) {
    return { status: 401, body: { ok: false, error: 'Unauthorized' } }
  }

  if (!(await isAllowedUser(config, userAddress))) {
    return { status: 403, body: { ok: false, error: 'Forbidden: User not in allowed list' } }
  }

  try {
    const body = await request.json() as UpdateBody

    // Defaults to the legacy track so the endpoint keeps meaning exactly what it meant
    // before tracks existed. Targeting another track is always explicit.
    const track = body.track === undefined ? LEGACY_TRACK : body.track
    if (typeof track !== 'string' || !isValidTrackName(track)) {
      return { status: 400, body: { ok: false, error: "'track' must be a kebab-case string" } }
    }

    const ios = parsePlatform(body.ios, 'ios')
    if (typeof ios === 'string') {
      return { status: 400, body: { ok: false, error: ios } }
    }
    const android = parsePlatform(body.android, 'android')
    if (typeof android === 'string') {
      return { status: 400, body: { ok: false, error: android } }
    }

    for (const [platform, versions] of [['ios', ios], ['android', android]] as const) {
      const capError = validateTrackMinimal(track, versions.minimalRequiredVersionNumber, platform)
      if (capError) {
        return { status: 400, body: { ok: false, error: capError } }
      }
    }

    const update: AppVersions = { ios, android }
    const data = await appVersionsDb.update(track, update, userAddress)
    if (!data) {
      return { status: 404, body: { ok: false, error: `Unknown track '${track}'` } }
    }

    logger.info('App versions updated', { track, updatedBy: userAddress })

    return { status: 200, body: { ok: true, data: { track, ...data } } }
  } catch (error) {
    logger.error('Error updating app versions', {
      error: (error as Error).message,
      updatedBy: userAddress
    })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
