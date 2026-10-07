// Validation and parsing for push campaigns (godot-explorer#2585).
//
// Everything here mirrors a CHECK constraint on push_campaigns. The constraint is the real
// guarantee; these exist so a person editing a campaign gets told what is wrong instead of a
// 500 from a violated check.

export const CAMPAIGN_KEY_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const CAMPAIGN_KEY_MAX_LENGTH = 64

// Android collapses long text in the tray; past these the copy is written for a preview
// nobody sees. Not constraints — a truncated notification still delivers — so they are
// warnings at the API level rather than rejections.
export const TITLE_SOFT_LIMIT = 65
export const BODY_SOFT_LIMIT = 240

export const TITLE_MAX_LENGTH = 200
export const BODY_MAX_LENGTH = 1000

// FCM refuses to retain a message for longer than four weeks, and silently clamps anything
// past it, so accepting a larger number would store one that does not mean what it says.
export const TTL_MAX_SECONDS = 2419200
export const TTL_DEFAULT_SECONDS = 86400

export type PushPlatform = 'android' | 'ios'

// An APNs device token is exactly 32 bytes rendered as hex. An FCM registration token is
// longer and always carries a ':' (`<instance id>:APA91b…`), so the two shapes never overlap.
const APNS_TOKEN_REGEX = /^[0-9a-f]{64}$/i

export function platformForToken(token: string): PushPlatform {
  return APNS_TOKEN_REGEX.test(token) ? 'ios' : 'android'
}

export const FEED_DESTINATION_KINDS = ['scene', 'plaza', 'discover'] as const
export type FeedDestinationKind = (typeof FEED_DESTINATION_KINDS)[number]

// A World is reached by realm and a Genesis City scene by position. The warehouse publishes
// which one it is and the identifier; the link is built here, because this is where the
// allow-list of routes the client accepts lives and where the result has to be safe to put in
// a URL. Both patterns admit only characters that are already URL-safe, so a name or a
// position that could add a parameter is rejected rather than escaped.
const WORLD_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/
const BASE_POSITION_PATTERN = /^-?\d{1,4},-?\d{1,4}$/
const TRIGGER_KEY_PATTERN = /^[a-z0-9]+$/

export type FeedDestination = {
  isWorld: boolean | null
  worldName: string | null
  basePosition: string | null
}

/**
 * The deep link for a resolved scene destination, or null when the warehouse gave no usable
 * identity. Null is not an error: `plaza` and `discover` rows carry none on purpose and fall
 * back to their campaign's own link.
 */
export function destinationDeepLink(destination: FeedDestination): string | null {
  if (destination.isWorld === true) {
    const name = (destination.worldName ?? '').trim().toLowerCase()
    return WORLD_NAME_PATTERN.test(name) ? `decentraland://open?realm=${name}` : null
  }
  if (destination.isWorld === false) {
    const position = (destination.basePosition ?? '').trim()
    return BASE_POSITION_PATTERN.test(position) ? `decentraland://open?position=${position}` : null
  }
  return null
}

export type CampaignContent = {
  title: string
  body: string
  deepLink: string
  imageUrl: string | null
  ttlSeconds: number
  scheduledAt: string | null
  isRecurring: boolean
  triggerKey: string | null
  destinationKind: FeedDestinationKind | null
}

export function validateCampaignKey(key: unknown): string | null {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return "'campaignKey' is required and must be a non-empty string"
  }
  if (key.length > CAMPAIGN_KEY_MAX_LENGTH) {
    return `'campaignKey' must be at most ${CAMPAIGN_KEY_MAX_LENGTH} characters`
  }
  if (!CAMPAIGN_KEY_REGEX.test(key)) {
    return "'campaignKey' must be kebab-case (lowercase letters, digits and dashes, e.g. 'spring-event')"
  }
  return null
}

/**
 * Validate the editable content of a campaign and return it canonicalised.
 *
 * The deep link is checked for scheme only. Whether the destination exists is a different
 * question, answered by the backoffice against /places while the PM is still typing —
 * refusing it here would block a campaign for a world that is about to be deployed.
 */
/**
 * Where a campaign is allowed to send someone.
 *
 * An allow-list rather than a block-list because the client parses around twenty deep-link
 * params and keeps gaining them: `dclenv` switches environment and signs the user out,
 * `saved-profile` and `fake-owned-wearables` rewrite who they are, `preview` and
 * `scene-inspector` point the app at developer infrastructure.
 *
 * Reaching any of those used to require getting somebody to tap a link you handed them. A
 * campaign is a server-side write that lands on every device in its audience at once, so what
 * a campaign link may say is narrowed to the shapes that mean "go here". Widening this is a
 * deliberate decision, which is the point of it being a list.
 */
const ALLOWED_DEEP_LINK_ROUTES: Record<string, string[]> = {
  open: ['position', 'location', 'realm'],
  events: ['id'],
  places: ['id']
}

export function deepLinkRouteError(deepLink: string): string | null {
  let url: URL
  try {
    url = new URL(deepLink)
  } catch {
    return "'deepLink' is not a valid URL"
  }

  const allowed = ALLOWED_DEEP_LINK_ROUTES[url.host]
  if (!allowed) {
    return `'deepLink' must address one of: ${Object.keys(ALLOWED_DEEP_LINK_ROUTES).join(', ')}`
  }
  for (const param of url.searchParams.keys()) {
    if (!allowed.includes(param)) {
      return `'deepLink' may not carry '${param}'; '${url.host}' accepts: ${allowed.join(', ')}`
    }
  }
  return null
}

export function validateCampaignContent(body: any): { error: string } | { content: CampaignContent } {
  if (typeof body?.title !== 'string' || body.title.trim().length === 0) {
    return { error: "'title' is required and must be a non-empty string" }
  }
  if (body.title.length > TITLE_MAX_LENGTH) {
    return { error: `'title' must be at most ${TITLE_MAX_LENGTH} characters` }
  }
  if (typeof body?.body !== 'string' || body.body.trim().length === 0) {
    return { error: "'body' is required and must be a non-empty string" }
  }
  if (body.body.length > BODY_MAX_LENGTH) {
    return { error: `'body' must be at most ${BODY_MAX_LENGTH} characters` }
  }

  const deepLink = body?.deepLink
  if (typeof deepLink !== 'string' || !deepLink.startsWith('decentraland://')) {
    return { error: "'deepLink' is required and must start with 'decentraland://'" }
  }
  // The sender appends push_campaign_id / push_id / source. A link that already carries them
  // would end up with the param twice, and which one the client reads is not worth guessing.
  for (const reserved of ['push_campaign_id', 'push_id', 'source']) {
    if (deepLink.includes(`${reserved}=`)) {
      return { error: `'deepLink' must not set '${reserved}'; it is added automatically when sending` }
    }
  }
  // `c=` is the ad campaign token, captured sticky by the client as the install's
  // attribution. A push travelling with one would overwrite where a user came from.
  if (/[?&]c=/.test(deepLink)) {
    return { error: "'deepLink' must not set 'c'; that param belongs to install attribution" }
  }
  // Checked after the two above so their more specific messages win: both name params that the
  // allow-list would reject anyway, but "belongs to install attribution" tells the operator why.
  const routeError = deepLinkRouteError(deepLink)
  if (routeError) {
    return { error: routeError }
  }

  const imageUrl = body?.imageUrl ?? null
  if (imageUrl !== null) {
    if (typeof imageUrl !== 'string' || !/^https:\/\//.test(imageUrl)) {
      return { error: "'imageUrl' must be an https URL when present" }
    }
  }

  const ttlSeconds = body?.ttlSeconds ?? TTL_DEFAULT_SECONDS
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > TTL_MAX_SECONDS) {
    return { error: `'ttlSeconds' must be an integer between 1 and ${TTL_MAX_SECONDS} (four weeks)` }
  }

  const scheduledAt = body?.scheduledAt ?? null
  if (scheduledAt !== null) {
    if (typeof scheduledAt !== 'string' || Number.isNaN(Date.parse(scheduledAt))) {
      return { error: "'scheduledAt' must be an ISO-8601 timestamp when present" }
    }
  }

  // A recurring campaign is fed by the warehouse instead of by an uploaded audience, and never
  // closes itself when its queue empties. Defaults to false: a campaign somebody is creating by
  // hand in the backoffice is the one-shot kind unless they say otherwise.
  const isRecurring = body?.isRecurring ?? false
  if (typeof isRecurring !== 'boolean') {
    return { error: "'isRecurring' must be a boolean when present" }
  }

  // Which slice of the audience feed this campaign takes. The warehouse publishes a trigger
  // and a kind of destination and names no campaign, so this is what points the two at each
  // other, and a campaign without it is one whose audience is uploaded by hand.
  const triggerKey = body?.triggerKey ?? null
  const destinationKind = body?.destinationKind ?? null
  if (triggerKey !== null || destinationKind !== null) {
    if (typeof triggerKey !== 'string' || !TRIGGER_KEY_PATTERN.test(triggerKey)) {
      return { error: "'triggerKey' must be a lifecycle trigger such as 'd3' when a slice is claimed" }
    }
    if (!FEED_DESTINATION_KINDS.includes(destinationKind)) {
      return {
        error: `'destinationKind' must be one of: ${FEED_DESTINATION_KINDS.join(', ')} when a slice is claimed`
      }
    }
    if (!isRecurring) {
      return { error: "a campaign that claims a slice of the audience feed must set 'isRecurring'" }
    }
  }

  return {
    content: {
      title: body.title.trim(),
      body: body.body.trim(),
      deepLink,
      imageUrl,
      ttlSeconds,
      scheduledAt,
      isRecurring,
      triggerKey,
      destinationKind
    }
  }
}

/** Copy that will be visually truncated on a real device. Advisory, never a rejection. */
export function contentWarnings(content: CampaignContent): string[] {
  const warnings: string[] = []
  if (content.title.length > TITLE_SOFT_LIMIT) {
    warnings.push(`title is ${content.title.length} characters; Android truncates past ~${TITLE_SOFT_LIMIT}`)
  }
  if (content.body.length > BODY_SOFT_LIMIT) {
    warnings.push(`body is ${content.body.length} characters; Android truncates past ~${BODY_SOFT_LIMIT}`)
  }
  return warnings
}

export type ParsedAudience = {
  entries: { userId: string; token: string; platform: PushPlatform }[]
  /** Line numbers (1-based, as the operator sees them) that could not be read, with why. */
  invalid: { line: number; reason: string }[]
}

// An FCM registration token is opaque, but it is always long and never contains a comma or
// whitespace. The point is to catch a column swap or a half-pasted file, not to validate FCM.
const MIN_TOKEN_LENGTH = 20

/**
 * Parse a `user_id,token[,platform]` CSV export.
 *
 * The audience comes out of the warehouse by hand, so the failure modes are human: a header
 * row, a trailing newline, quoted fields from a spreadsheet, columns the other way round.
 * Every row that cannot be read is reported with its line number rather than dropped, because
 * silently sending to fewer people than intended is indistinguishable from success.
 *
 * `platform` is optional: when the column is missing it is read off the token's shape, which
 * is what keeps the original `user_id,fcm_token` exports working unchanged.
 */
export function parseAudienceCsv(text: string): ParsedAudience {
  const entries: { userId: string; token: string; platform: PushPlatform }[] = []
  const invalid: { line: number; reason: string }[] = []

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNumber = i + 1
    if (raw.trim().length === 0) {
      continue
    }

    const fields = raw.split(',').map((field) => field.trim().replace(/^"(.*)"$/, '$1'))

    // Header, in whichever casing the export produced.
    if (i === 0 && fields[0]?.toLowerCase().replace(/_/g, '') === 'userid') {
      continue
    }

    if (fields.length < 2) {
      invalid.push({ line: lineNumber, reason: 'expected two comma-separated columns' })
      continue
    }
    const [userId, token, platformField] = fields
    if (!userId) {
      invalid.push({ line: lineNumber, reason: 'empty user_id' })
      continue
    }
    if (!token) {
      invalid.push({ line: lineNumber, reason: 'empty token' })
      continue
    }
    if (token.length < MIN_TOKEN_LENGTH) {
      // Almost always the columns the other way round, which would otherwise send the whole
      // campaign to nobody and report it as a success.
      invalid.push({ line: lineNumber, reason: 'token too short — are the columns swapped?' })
      continue
    }

    let platform: PushPlatform
    const declared = (platformField ?? '').toLowerCase()
    if (declared === '') {
      platform = platformForToken(token)
    } else if (declared === 'android' || declared === 'ios') {
      platform = declared
    } else {
      invalid.push({ line: lineNumber, reason: `unknown platform '${platformField}' (android or ios)` })
      continue
    }

    entries.push({ userId, token, platform })
  }

  return { entries, invalid }
}
