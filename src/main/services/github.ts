import { Octokit } from '@octokit/rest'
import type { RemoteRepo } from '@shared/types'

/** GitHub REST API 封装（octokit），全部接受显式 token，便于测试与脱敏 */
export class GithubService {
  async getAuthenticated(token: string): Promise<string> {
    const octokit = new Octokit({ auth: token })
    const { data } = await octokit.rest.users.getAuthenticated()
    return data.login
  }

  async listRepos(token: string): Promise<RemoteRepo[]> {
    const octokit = new Octokit({ auth: token })
    const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      visibility: 'all',
      affiliation: 'owner',
      sort: 'updated',
      per_page: 100
    })
    return repos.map((r) => ({
      fullName: r.full_name,
      description: r.description,
      private: r.private,
      updatedAt: r.updated_at ?? ''
    }))
  }

  async createRepo(token: string, name: string, isPrivate: boolean): Promise<string> {
    const octokit = new Octokit({ auth: token })
    const { data } = await octokit.rest.repos.createForAuthenticatedUser({
      name,
      private: isPrivate,
      auto_init: false
    })
    return data.full_name
  }
}
