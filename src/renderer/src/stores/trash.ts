import { defineStore } from 'pinia'
import type { RemoteRepo, TrashEntry } from '@shared/types'

/** 回收站数据 */
export const useTrashStore = defineStore('trash', {
  state: () => ({
    entries: [] as TrashEntry[],
    loading: false
  }),
  actions: {
    async load(): Promise<void> {
      this.loading = true
      try {
        const result = await window.trace.listTrash()
        if (result.ok && result.entries) this.entries = result.entries
      } finally {
        this.loading = false
      }
    },
    async restore(id: string): Promise<boolean> {
      const result = await window.trace.restoreTrash(id)
      if (result.ok) {
        await this.load()
        return true
      }
      return false
    },
    async purge(id: string): Promise<boolean> {
      const result = await window.trace.purgeTrash(id)
      if (result.ok) {
        await this.load()
        return true
      }
      return false
    },
    async empty(): Promise<boolean> {
      const result = await window.trace.emptyTrash()
      if (result.ok) {
        await this.load()
        return true
      }
      return false
    }
  }
})

/** 远程仓库列表（关联对话框用） */
export const useRemoteRepos = defineStore('remoteRepos', {
  state: () => ({
    repos: [] as RemoteRepo[],
    loading: false,
    error: ''
  }),
  actions: {
    async load(): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        const result = await window.trace.listRemoteRepos()
        if (result.ok && result.repos) this.repos = result.repos
        else this.error = result.error ?? '获取仓库列表失败'
      } finally {
        this.loading = false
      }
    },
    async create(name: string, isPrivate: boolean): Promise<{ ok: boolean; fullName?: string; error?: string }> {
      const result = await window.trace.createRemoteRepo(name, isPrivate)
      if (result.ok && result.fullName) {
        await this.load()
        return { ok: true, fullName: result.fullName }
      }
      return { ok: false, error: result.error ?? '创建失败' }
    }
  }
})
