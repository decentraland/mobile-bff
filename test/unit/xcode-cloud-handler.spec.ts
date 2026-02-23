import { xcodeCloudWebhookHandler } from '../../src/controllers/handlers/webhook/xcode-cloud-handler'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { IGitHubApiComponent } from '../../src/adapters/github-api'
import { IAppStoreConnectComponent } from '../../src/adapters/app-store-connect'

function createMockLogger(): ILoggerComponent {
  const noOp = () => {}
  return {
    getLogger: () => ({
      log: noOp,
      debug: noOp,
      info: noOp,
      warn: noOp,
      error: noOp
    })
  }
}

function createMockGitHubApi(overrides: Partial<IGitHubApiComponent> = {}): IGitHubApiComponent {
  return {
    getPullRequest: jest.fn().mockResolvedValue({ title: 'Fix reminder button', body: null }),
    getLastCommitMessage: jest.fn().mockResolvedValue('fix account deletion flow'),
    ...overrides
  }
}

function createMockAppStoreConnect(overrides: Partial<IAppStoreConnectComponent> = {}): IAppStoreConnectComponent {
  return {
    findLatestBuild: jest.fn().mockResolvedValue({ id: 'build-123', version: '212' }),
    setBetaBuildWhatsNew: jest.fn().mockResolvedValue(true),
    ...overrides
  }
}

function createContext(
  payload: any,
  overrides: {
    githubApi?: Partial<IGitHubApiComponent>
    appStoreConnect?: Partial<IAppStoreConnectComponent>
  } = {}
) {
  return {
    request: {
      json: () => Promise.resolve(payload)
    } as any,
    components: {
      logs: createMockLogger(),
      githubApi: createMockGitHubApi(overrides.githubApi),
      appStoreConnect: createMockAppStoreConnect(overrides.appStoreConnect)
    }
  }
}

function makePayload(branchName: string, completionStatus = 'SUCCEEDED', executionProgress = 'COMPLETE') {
  return {
    ciBuildRun: {
      attributes: { completionStatus, executionProgress }
    },
    scmGitReference: {
      attributes: { name: branchName, kind: 'BRANCH' }
    }
  }
}

describe('xcode-cloud-webhook-handler', () => {
  describe('branch name parsing', () => {
    it('should extract PR number from PR-1424-main', async () => {
      const ctx = createContext(makePayload('PR-1424-main'))
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(ctx.components.githubApi.getPullRequest).toHaveBeenCalledWith(1424)
      expect(ctx.components.appStoreConnect.setBetaBuildWhatsNew).toHaveBeenCalledWith(
        'build-123',
        'PR #1424: Fix reminder button\n\nfix account deletion flow'
      )
    })

    it('should extract PR number from EXT-99-main', async () => {
      const ctx = createContext(makePayload('EXT-99-main'))
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(ctx.components.githubApi.getPullRequest).toHaveBeenCalledWith(99)
    })

    it('should handle non-PR branches (main)', async () => {
      const ctx = createContext(makePayload('main'))
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(ctx.components.githubApi.getPullRequest).not.toHaveBeenCalled()
      expect(ctx.components.appStoreConnect.setBetaBuildWhatsNew).toHaveBeenCalledWith(
        'build-123',
        'Build from main'
      )
    })

    it('should handle non-PR branches (release)', async () => {
      const ctx = createContext(makePayload('release'))
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(ctx.components.appStoreConnect.setBetaBuildWhatsNew).toHaveBeenCalledWith(
        'build-123',
        'Build from release'
      )
    })
  })

  describe('build status filtering', () => {
    it('should ignore FAILED builds', async () => {
      const ctx = createContext(makePayload('PR-100-main', 'FAILED'))
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(result.body.message).toBe('Ignored: build not successful')
      expect(ctx.components.githubApi.getPullRequest).not.toHaveBeenCalled()
    })

    it('should ignore IN_PROGRESS builds', async () => {
      const ctx = createContext(makePayload('PR-100-main', 'SUCCEEDED', 'IN_PROGRESS'))
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(result.body.message).toBe('Ignored: build not successful')
    })

    it('should ignore builds with no completion status', async () => {
      const ctx = createContext({ ciBuildRun: { attributes: {} } })
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(result.body.message).toBe('Ignored: build not successful')
    })
  })

  describe('error handling', () => {
    it('should return 200 when GitHub API fails', async () => {
      const ctx = createContext(makePayload('PR-1424-main'), {
        githubApi: {
          getPullRequest: jest.fn().mockResolvedValue(null),
          getLastCommitMessage: jest.fn().mockResolvedValue(null)
        }
      })
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(ctx.components.appStoreConnect.setBetaBuildWhatsNew).toHaveBeenCalledWith(
        'build-123',
        'PR #1424'
      )
    })

    it('should return 200 when build not found in ASC', async () => {
      const ctx = createContext(makePayload('PR-1424-main'), {
        appStoreConnect: {
          findLatestBuild: jest.fn().mockResolvedValue(null)
        }
      })
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(result.body.message).toBe('Build not found in ASC yet')
    })

    it('should return 200 when setBetaBuildWhatsNew fails', async () => {
      const ctx = createContext(makePayload('PR-1424-main'), {
        appStoreConnect: {
          setBetaBuildWhatsNew: jest.fn().mockResolvedValue(false)
        }
      })
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(result.body.message).toBe('Failed to update')
    })

    it('should return 200 when request body parsing throws', async () => {
      const ctx = {
        request: {
          json: () => Promise.reject(new Error('Invalid JSON'))
        } as any,
        components: {
          logs: createMockLogger(),
          githubApi: createMockGitHubApi(),
          appStoreConnect: createMockAppStoreConnect()
        }
      }
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(result.body.message).toBe('Error processing webhook')
    })

    it('should return 200 when no branch name in payload', async () => {
      const ctx = createContext({
        ciBuildRun: { attributes: { completionStatus: 'SUCCEEDED', executionProgress: 'COMPLETE' } },
        scmGitReference: { attributes: {} }
      })
      const result = await xcodeCloudWebhookHandler(ctx)

      expect(result.status).toBe(200)
      expect(result.body.message).toBe('Ignored: no branch name')
    })
  })

  describe('What to Test content', () => {
    it('should include PR title and last commit for PR builds', async () => {
      const ctx = createContext(makePayload('PR-42-main'), {
        githubApi: {
          getPullRequest: jest.fn().mockResolvedValue({ title: 'Add dark mode support', body: null }),
          getLastCommitMessage: jest.fn().mockResolvedValue('fix toggle animation')
        }
      })
      await xcodeCloudWebhookHandler(ctx)

      expect(ctx.components.appStoreConnect.setBetaBuildWhatsNew).toHaveBeenCalledWith(
        'build-123',
        'PR #42: Add dark mode support\n\nfix toggle animation'
      )
    })

    it('should handle PR with no last commit message', async () => {
      const ctx = createContext(makePayload('PR-42-main'), {
        githubApi: {
          getPullRequest: jest.fn().mockResolvedValue({ title: 'Add dark mode', body: null }),
          getLastCommitMessage: jest.fn().mockResolvedValue(null)
        }
      })
      await xcodeCloudWebhookHandler(ctx)

      expect(ctx.components.appStoreConnect.setBetaBuildWhatsNew).toHaveBeenCalledWith(
        'build-123',
        'PR #42: Add dark mode'
      )
    })

    it('should show PR number with commit when PR fetch fails but commits succeed', async () => {
      const ctx = createContext(makePayload('PR-42-main'), {
        githubApi: {
          getPullRequest: jest.fn().mockResolvedValue(null),
          getLastCommitMessage: jest.fn().mockResolvedValue('some commit')
        }
      })
      await xcodeCloudWebhookHandler(ctx)

      expect(ctx.components.appStoreConnect.setBetaBuildWhatsNew).toHaveBeenCalledWith(
        'build-123',
        'PR #42\n\nsome commit'
      )
    })
  })
})
