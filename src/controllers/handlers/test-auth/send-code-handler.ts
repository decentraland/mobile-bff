import { HandlerContextWithPath } from '../../../types'

const MAX_EMAIL_LENGTH = 320

type SendCodeBody = {
  email: string
}

export async function testAuthSendCodeHandler(
  context: HandlerContextWithPath<'config' | 'logs', '/test-auth/send-code'>
) {
  const { components: { config, logs }, request } = context
  const logger = logs.getLogger('test-auth-send-code')

  logger.info('send-code hit')

  const testEmail = await config.getString('TEST_AUTH_EMAIL')
  if (!testEmail) {
    logger.warn('TEST_AUTH_EMAIL not configured, returning 404')
    return { status: 404, body: { ok: false, error: 'Not found' } }
  }

  let body: SendCodeBody
  try {
    body = await request.json() as SendCodeBody
  } catch {
    logger.warn('Invalid JSON body')
    return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
  }

  if (!body.email || typeof body.email !== 'string' || body.email.length > MAX_EMAIL_LENGTH) {
    logger.warn('Invalid or missing email')
    return { status: 400, body: { ok: false, error: 'Invalid email' } }
  }

  logger.info('send-code request', { email: body.email })

  if (body.email.toLowerCase() !== testEmail.toLowerCase()) {
    logger.info('Email rejected, not the test email', { email: body.email })
    return { status: 403, body: { ok: false, error: 'Email not allowed' } }
  }

  logger.info('Test auth code accepted', { email: body.email })

  return { status: 200, body: { ok: true } }
}
