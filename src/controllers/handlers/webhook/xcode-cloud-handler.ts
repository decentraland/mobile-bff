import { HandlerContextWithPath } from '../../../types'

type XcodeCloudWebhookPayload = {
  ciBuildRun?: {
    attributes?: {
      completionStatus?: string
      executionProgress?: string
    }
  }
  scmGitReference?: {
    attributes?: {
      name?: string
      kind?: string
    }
  }
}

function parsePRNumber(branchName: string): number | null {
  const match = branchName.match(/^(?:PR|EXT)-(\d+)-/)
  return match ? parseInt(match[1], 10) : null
}

export async function xcodeCloudWebhookHandler(
  context: Pick<
    HandlerContextWithPath<'logs' | 'githubApi' | 'appStoreConnect', '/webhook/xcode-cloud'>,
    'request' | 'components'
  >
) {
  const {
    components: { logs, githubApi, appStoreConnect }
  } = context
  const logger = logs.getLogger('xcode-cloud-webhook')

  try {
    const body = (await context.request.json()) as XcodeCloudWebhookPayload

    const completionStatus = body.ciBuildRun?.attributes?.completionStatus
    const executionProgress = body.ciBuildRun?.attributes?.executionProgress

    if (executionProgress !== 'COMPLETE' || completionStatus !== 'SUCCEEDED') {
      logger.info('Ignoring non-successful build', { completionStatus, executionProgress })
      return { status: 200, body: { ok: true, message: 'Ignored: build not successful' } }
    }

    const branchName = body.scmGitReference?.attributes?.name
    if (!branchName) {
      logger.warn('No branch name in webhook payload')
      return { status: 200, body: { ok: true, message: 'Ignored: no branch name' } }
    }

    logger.info('Processing successful build', { branchName })

    const prNumber = parsePRNumber(branchName)
    let whatsNew: string

    if (prNumber) {
      const pr = await githubApi.getPullRequest(prNumber)
      const lastCommit = await githubApi.getLastCommitMessage(prNumber)

      if (pr) {
        whatsNew = `PR #${prNumber}: ${pr.title}`
        if (lastCommit) {
          whatsNew += `\n\n${lastCommit}`
        }
      } else {
        whatsNew = `PR #${prNumber}`
        if (lastCommit) {
          whatsNew += `\n\n${lastCommit}`
        }
      }
    } else {
      whatsNew = `Build from ${branchName}`
    }

    const build = await appStoreConnect.findLatestBuild()
    if (!build) {
      logger.warn('No build found in App Store Connect (may not be processed yet)')
      return { status: 200, body: { ok: true, message: 'Build not found in ASC yet' } }
    }

    logger.info('Setting What to Test', { buildId: build.id, buildVersion: build.version, whatsNew })
    const success = await appStoreConnect.setBetaBuildWhatsNew(build.id, whatsNew)

    if (!success) {
      logger.error('Failed to set What to Test')
    }

    return { status: 200, body: { ok: true, message: success ? 'What to Test updated' : 'Failed to update' } }
  } catch (error) {
    logger.error('Error processing Xcode Cloud webhook', { error: (error as Error).message })
    return { status: 200, body: { ok: true, message: 'Error processing webhook' } }
  }
}
