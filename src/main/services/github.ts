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

  // ---------- Gist 分享（FR-2.3.10） ----------

  /** 发布 secret gist（有链接即可见、不被公开检索）；令牌缺 gist scope 时 octokit 抛 404 */
  async createGist(token: string, fileName: string, content: string, description: string): Promise<{ id: string; url: string }> {
    const octokit = new Octokit({ auth: token })
    const { data } = await octokit.rest.gists.create({
      description,
      public: false,
      files: { [fileName]: { content } }
    })
    return { id: data.id ?? '', url: data.html_url ?? '' }
  }

  /** 更新既有 gist 的内容（同一笔记再次分享）；远端已删除时抛 404 由调用方处理 */
  async updateGist(token: string, gistId: string, fileName: string, content: string, description: string): Promise<{ id: string; url: string }> {
    const octokit = new Octokit({ auth: token })
    const { data } = await octokit.rest.gists.update({
      gist_id: gistId,
      description,
      files: { [fileName]: { content } }
    })
    return { id: data.id ?? gistId, url: data.html_url ?? '' }
  }

  async deleteGist(token: string, gistId: string): Promise<void> {
    const octokit = new Octokit({ auth: token })
    await octokit.rest.gists.delete({ gist_id: gistId })
  }
}
