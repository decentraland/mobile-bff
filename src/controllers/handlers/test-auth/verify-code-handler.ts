import { Authenticator, AuthIdentity } from '@dcl/crypto'
import { createUnsafeIdentity, recoverAddressFromEthSignature } from '@dcl/crypto/dist/crypto'
import { HandlerContextWithPath } from '../../../types'

type VerifyCodeBody = {
  email: string
  code: string
}

const THREE_MONTHS_IN_MINUTES = 90 * 24 * 60
const MAX_EMAIL_LENGTH = 320
const MAX_CODE_LENGTH = 32
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_ATTEMPTS = 5

// In-memory rate limiter keyed by IP. Resets on restart — good enough for a
// test-only endpoint that only Apple reviewers hit.
const attempts = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS
}

function deriveAddress(privateKey: string): string {
  const sig = Authenticator.createSignature(
    { privateKey, publicKey: '', address: '' },
    'derive-address'
  )
  return recoverAddressFromEthSignature(sig, 'derive-address')
}

async function generateTestIdentity(mainPrivateKey: string): Promise<{ identity: AuthIdentity; address: string }> {
  const mainAddress = deriveAddress(mainPrivateKey)
  const ephemeral = createUnsafeIdentity()

  const signerIdentity = { privateKey: mainPrivateKey, publicKey: mainAddress, address: mainAddress }
  const signer = (message: string) =>
    Promise.resolve(Authenticator.createSignature(signerIdentity, message))

  const identity = await Authenticator.initializeAuthChain(
    mainAddress,
    ephemeral,
    THREE_MONTHS_IN_MINUTES,
    signer
  )

  return { identity, address: mainAddress }
}

export async function testAuthVerifyCodeHandler(
  context: HandlerContextWithPath<'config' | 'logs', '/test-auth/verify-code'>
) {
  const { components: { config, logs }, request } = context
  const logger = logs.getLogger('test-auth-verify-code')

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  logger.info('verify-code hit', { ip })

  if (isRateLimited(ip)) {
    logger.warn('Rate limited', { ip })
    return { status: 429, body: { ok: false, error: 'Too many attempts. Try again later.' } }
  }

  const testEmail = await config.getString('TEST_AUTH_EMAIL')
  const testCode = await config.getString('TEST_AUTH_OTP_CODE')
  const testPrivateKey = await config.getString('TEST_AUTH_PRIVATE_KEY')

  if (!testEmail || !testCode || !testPrivateKey) {
    logger.warn('Test auth env vars not fully configured')
    return { status: 404, body: { ok: false, error: 'Not found' } }
  }

  let body: VerifyCodeBody
  try {
    body = await request.json() as VerifyCodeBody
  } catch {
    logger.warn('Invalid JSON body')
    return { status: 400, body: { ok: false, error: 'Invalid JSON body' } }
  }

  if (!body.email || typeof body.email !== 'string' || body.email.length > MAX_EMAIL_LENGTH) {
    logger.warn('Invalid or missing email')
    return { status: 400, body: { ok: false, error: 'Invalid email' } }
  }

  if (!body.code || typeof body.code !== 'string' || body.code.length > MAX_CODE_LENGTH) {
    logger.warn('Invalid or missing code')
    return { status: 400, body: { ok: false, error: 'Invalid code' } }
  }

  logger.info('verify-code request', { email: body.email })

  if (body.email.toLowerCase() !== testEmail.toLowerCase()) {
    logger.info('Email rejected, not the test email', { email: body.email })
    return { status: 403, body: { ok: false, error: 'Email not allowed' } }
  }

  if (body.code !== testCode) {
    logger.info('Invalid code submitted', { email: body.email })
    return { status: 401, body: { ok: false, error: 'Invalid verification code' } }
  }

  try {
    const { identity, address } = await generateTestIdentity(testPrivateKey)
    logger.info('Test auth identity generated', { email: body.email, address })

    return {
      status: 200,
      body: { ok: true, data: { identity, address } }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Error generating test identity', { error: message })
    return { status: 500, body: { ok: false, error: 'Internal server error' } }
  }
}
