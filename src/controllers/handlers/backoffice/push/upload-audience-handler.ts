import { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import { HandlerContextWithPath } from '../../../../types'
import { parseAudienceCsv } from '../../../../logic/push'
import { requireBackofficeUser, notFound } from './shared'

// One row is ~200 bytes, so this is roughly 250k recipients — an order of magnitude above
// the whole Android install base. The cap exists so a wrong file cannot be streamed into
// memory, not to limit real campaigns.
const MAX_BODY_BYTES = 50 * 1024 * 1024

export async function uploadPushAudienceHandler(
  context: HandlerContextWithPath<'pushDb' | 'logs' | 'config', '/backoffice/push/campaigns/:id/audience'> &
    DecentralandSignatureContext<any>
) {
  const {
    components: { pushDb, logs, config },
    verification,
    params,
    request
  } = context

  const logger = logs.getLogger('upload-push-audience')
  const auth = await requireBackofficeUser(config, verification)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const campaign = await pushDb.getCampaign(params.id)
    if (!campaign) {
      return notFound(params.id)
    }
    // Changing who receives a campaign after it was approved would make the approval mean
    // something else than what was approved, and after it started sending the numbers would
    // stop adding up.
    if (campaign.status !== 'draft' && campaign.status !== 'pending_approval') {
      return {
        status: 409,
        body: { ok: false, error: `Audience can only be set before approval; this campaign is '${campaign.status}'` }
      }
    }

    const text = await request.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return { status: 413, body: { ok: false, error: 'Audience file is too large' } }
    }

    const parsed = parseAudienceCsv(text)
    const report = await pushDb.replaceAudience(params.id, parsed.entries)

    logger.info('Push audience uploaded', {
      id: params.id,
      valid: report.valid,
      invalid: parsed.invalid.length,
      duplicates: report.duplicates,
      suppressed: report.suppressed,
      uploadedBy: auth.address
    })

    return {
      status: 200,
      body: {
        ok: true,
        data: {
          ...report,
          // Reported with line numbers rather than dropped: sending to fewer people than
          // intended looks exactly like success unless somebody is told.
          invalid: parsed.invalid
        }
      }
    }
  } catch (error) {
    logger.error('Error uploading push audience', { error: (error as Error).message, id: params.id })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
