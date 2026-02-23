import { AppComponents } from '../types'

export type IGitHubApiComponent = {
  getPullRequest(prNumber: number): Promise<{ title: string; body: string | null } | null>
  getLastCommitMessage(prNumber: number): Promise<string | null>
}

export async function createGitHubApiComponent({
  config,
  fetch,
  logs
}: Pick<AppComponents, 'config' | 'fetch' | 'logs'>): Promise<IGitHubApiComponent> {
  const logger = logs.getLogger('github-api')
  const token = await config.getString('GITHUB_TOKEN')
  const repo = (await config.getString('GITHUB_REPO')) || 'decentraland/godot-explorer'

  function getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'mobile-bff'
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  async function getPullRequest(prNumber: number): Promise<{ title: string; body: string | null } | null> {
    try {
      const response = await fetch.fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
        headers: getHeaders()
      })

      if (!response.ok) {
        logger.error('Failed to fetch PR', { prNumber, status: response.status })
        return null
      }

      const data = (await response.json()) as { title: string; body: string | null }
      return { title: data.title, body: data.body }
    } catch (error) {
      logger.error('Error fetching PR', { prNumber, error: (error as Error).message })
      return null
    }
  }

  async function getLastCommitMessage(prNumber: number): Promise<string | null> {
    try {
      const response = await fetch.fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/commits`, {
        headers: getHeaders()
      })

      if (!response.ok) {
        logger.error('Failed to fetch PR commits', { prNumber, status: response.status })
        return null
      }

      const commits = (await response.json()) as Array<{ commit: { message: string } }>
      if (commits.length === 0) {
        return null
      }

      const lastCommit = commits[commits.length - 1]
      return lastCommit.commit.message.split('\n')[0]
    } catch (error) {
      logger.error('Error fetching PR commits', { prNumber, error: (error as Error).message })
      return null
    }
  }

  return {
    getPullRequest,
    getLastCommitMessage
  }
}
