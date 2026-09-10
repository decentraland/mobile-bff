import { HandlerContextWithPath } from '../../../types'
import { IAppVersionsDbComponent } from '../../../adapters/app-versions-db'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { LEGACY_TRACK, isValidTrackName } from '../../../logic/app-version-tracks'

async function respondWithTrack(appVersionsDb: IAppVersionsDbComponent, logs: ILoggerComponent, track: string) {
  const logger = logs.getLogger('get-app-versions')

  if (!isValidTrackName(track)) {
    return { status: 400, body: { ok: false, error: 'Invalid track name' } }
  }

  try {
    const data = await appVersionsDb.get(track)
    if (!data) {
      return { status: 404, body: { ok: false, error: `Unknown track '${track}'` } }
    }
    return {
      status: 200,
      body: { ok: true, data }
    }
  } catch (error) {
    logger.error('Error fetching app versions', { track, error: (error as Error).message })
    return {
      status: 500,
      body: { ok: false, error: 'Internal server error' }
    }
  }
}

// The bare endpoint is pinned to the legacy track: it is the only one clients up to 1.13.1
// know how to call, and a hard gate bricks those builds (see logic/app-version-tracks.ts).
export async function getAppVersionsHandler(
  context: HandlerContextWithPath<'appVersionsDb' | 'logs', '/app-versions'>
) {
  const {
    components: { appVersionsDb, logs }
  } = context

  return respondWithTrack(appVersionsDb, logs, LEGACY_TRACK)
}

export async function getAppVersionsByTrackHandler(
  context: HandlerContextWithPath<'appVersionsDb' | 'logs', '/app-versions/:track'>
) {
  const {
    components: { appVersionsDb, logs },
    params
  } = context

  return respondWithTrack(appVersionsDb, logs, params.track)
}
