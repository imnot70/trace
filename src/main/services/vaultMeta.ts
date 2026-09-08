import { JsonStore } from '../lib/jsonStore'

/**
 * 笔记库元数据（描述等应用级信息）。
 * 按设计原则存 userData 的 JSON，不写入笔记库目录，避免污染 git 仓库。
 */
export class VaultMetaService {
  constructor(private store: JsonStore<{ descs: Record<string, string> }>) {}

  get(vault: string): string | undefined {
    return this.store.get().descs[vault]
  }

  set(vault: string, desc: string): void {
    if (!desc) {
      this.remove(vault)
      return
    }
    this.store.update((d) => {
      d.descs[vault] = desc
    })
  }

  remove(vault: string): void {
    this.store.update((d) => {
      delete d.descs[vault]
    })
  }

  /** 库重命名时描述跟随 */
  rename(oldName: string, newName: string): void {
    const desc = this.get(oldName)
    this.store.update((d) => {
      delete d.descs[oldName]
      if (desc) d.descs[newName] = desc
    })
  }
}
