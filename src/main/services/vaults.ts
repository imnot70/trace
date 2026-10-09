import fs from 'node:fs'
import path from 'node:path'
import { checkNameFormat, checkDuplicate } from '@shared/validate'
import { resolveWithin } from '../lib/paths'
import { JsonStore } from '../lib/jsonStore'
import type { TrashService } from './trash'
import type { VaultInfo } from '@shared/types'

/** 笔记库管理：库 = 工作区根目录下的一个一级子目录；另有「外部笔记库」（FR-2.1.4）——
 *  注册在工作区之外的既有目录（典型场景：GitHub clone 到本地的笔记仓库），仅登记
 *  名称 → 绝对路径的映射（userData/open-vaults.json），绝不移动 / 删除用户目录。 */

/** 外部笔记库注册条目 */
export interface ExternalVault {
  name: string
  dir: string
}

export class VaultService {
  constructor(
    private getRoot: () => string | null,
    private trash: TrashService,
    /** 外部笔记库注册表（FR-2.1.4 起可选注入——单测可省略） */
    private externalStore?: JsonStore<{ vaults: ExternalVault[] }>
  ) {}

  list(): VaultInfo[] {
    const root = this.getRoot()
    const local: VaultInfo[] =
      root && fs.existsSync(root)
        ? fs
            .readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
            .map((e) => e.name)
            .map((name) => ({ name, path: path.join(root, name), git: null }))
        : []
    const externals: VaultInfo[] = this.externalList().map((e) => ({
      name: e.name,
      path: e.dir,
      git: null,
      external: true
    }))
    return [...local, ...externals].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  exists(name: string): boolean {
    return this.list().some((v) => v.name.toLowerCase() === name.toLowerCase())
  }

  /** 库的绝对路径（工作区库带逃逸校验；外部库直接返回注册的绝对路径） */
  vaultPath(name: string): string {
    const ext = this.externalList().find((e) => e.name.toLowerCase() === name.toLowerCase())
    if (ext) return ext.dir
    const root = this.getRoot()
    if (!root) throw new Error('尚未设置工作区')
    return resolveWithin(root, name)
  }

  create(name: string): { ok: boolean; error?: string } {
    const invalid = checkNameFormat(name, 'vault') ?? checkDuplicate(name, this.names(), 'vault')
    if (invalid) return { ok: false, error: invalid }
    try {
      fs.mkdirSync(path.join(this.vaultPath(name)), { recursive: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 打开已有目录为外部笔记库（FR-2.1.4）：仅注册，不移动 / 不复制 / 不改写目录内容。
   * 目录名即库名（须符合笔记库命名规则）；与现有库重名（大小写不敏感）时拒绝；
   * 重复打开同一目录幂等返回既有注册名。
   */
  openExternal(dir: string): { ok: boolean; name?: string; error?: string } {
    const abs = path.resolve(dir)
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      return { ok: false, error: '目录不存在或不可访问' }
    }
    if (!stat.isDirectory()) return { ok: false, error: '所选路径不是目录' }
    const existed = this.externalList().find((e) => pathsEqual(e.dir, abs))
    if (existed) return { ok: true, name: existed.name }
    const base = path.basename(abs)
    const invalid = checkNameFormat(base, 'vault')
    if (invalid) {
      return { ok: false, error: `目录名「${base}」不符合笔记库命名规则：${invalid}（请重命名目录后重试）` }
    }
    if (this.exists(base)) return { ok: false, error: `已存在同名笔记库「${base}」，请重命名目录后再打开` }
    this.externalStore?.update((d) => {
      d.vaults.push({ name: base, dir: abs })
    })
    return { ok: true, name: base }
  }

  /** 移除外部笔记库的注册（只解除登记，磁盘目录原样保留）；工作区内的库不适用 */
  removeExternal(name: string): { ok: boolean; error?: string } {
    const ext = this.externalList().find((e) => e.name.toLowerCase() === name.toLowerCase())
    if (!ext) return { ok: false, error: '该笔记库不是外部笔记库' }
    this.externalStore?.update((d) => {
      d.vaults = d.vaults.filter((e) => e.name !== ext.name)
    })
    return { ok: true }
  }

  isExternal(name: string): boolean {
    return this.externalList().some((e) => e.name.toLowerCase() === name.toLowerCase())
  }

  /** 外部笔记库注册列表（供文件监听等按目录挂接） */
  externalVaults(): ExternalVault[] {
    return this.externalList()
  }

  rename(oldName: string, newName: string): { ok: boolean; error?: string } {
    const others = this.names().filter((n) => n.toLowerCase() !== oldName.toLowerCase())
    const invalid =
      checkNameFormat(newName, 'vault') ??
      checkDuplicate(newName, others, 'vault') ??
      (this.exists(oldName) ? null : '笔记库不存在')
    if (invalid) return { ok: false, error: invalid }
    try {
      if (this.isExternal(oldName)) {
        // 外部库：只改注册显示名，绝不改动磁盘目录（目录属于用户，跨盘 rename 会搬走用户文件）
        this.externalStore?.update((d) => {
          const target = d.vaults.find((e) => e.name.toLowerCase() === oldName.toLowerCase())
          if (target) target.name = newName
        })
        return { ok: true }
      }
      fs.renameSync(this.vaultPath(oldName), this.vaultPath(newName))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 删除（工作区库 → 移入回收站；外部库 → 仅解除注册，磁盘文件不动） */
  delete(name: string): { ok: boolean; error?: string } {
    if (this.isExternal(name)) return this.removeExternal(name)
    if (!this.exists(name)) return { ok: false, error: '笔记库不存在' }
    return this.trash.put({ vault: name, path: '', kind: 'vault' })
  }

  private names(): string[] {
    return this.list().map((v) => v.name)
  }

  private externalList(): ExternalVault[] {
    return this.externalStore?.get().vaults ?? []
  }
}

/** 路径相等（分隔符与大小写归一，Windows 盘符 / 大小写差异容错） */
function pathsEqual(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}
