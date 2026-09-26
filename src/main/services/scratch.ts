import fs from 'node:fs'
import path from 'node:path'
import { contentHash } from './fsTree'
import { SCRATCH_VAULT } from '@shared/types'
export { SCRATCH_VAULT }

/** 草稿内图片资产的相对目录（引用写作 `assets/xxx`，转正时随迁改写） */
export const SCRATCH_ASSETS_DIR = 'assets'

/**
 * 草稿笔记（FR-2.3.9）：`userData/scratch/` 下的真实 Markdown 文件。
 * scratch 目录在工作区之外，因此搜索 / 双链 / 标签 / 同步等子系统天然不涉及（设计语义）；
 * 文件 IPC（read / write）按 vault 特例路由到本服务。
 */
export class ScratchService {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  /** 草稿根目录（协议 / 搜索等需要完整路径的场景使用） */
  get location(): string {
    return this.dir
  }

  /** 目录内路径解析（含越界校验，语义同 lib/paths.resolveWithin） */
  resolve(rel: string): string {
    const abs = path.resolve(this.dir, rel)
    const root = path.resolve(this.dir)
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error('非法路径')
    }
    return abs
  }

  /** 是否存在草稿（搜索范围 / 侧栏菜单的显示条件） */
  hasNotes(): boolean {
    return this.list().length > 0
  }

  /** 全部草稿（按修改时间倒序） */
  list(): { name: string; mtime: number }[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(this.dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  }

  /** 新建草稿：速记 MMDD-HHmmss.md，重名追加序号（含秒防同分钟冲突） */
  create(): { ok: boolean; name?: string; error?: string } {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      const now = new Date()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const hh = String(now.getHours()).padStart(2, '0')
      const mi = String(now.getMinutes()).padStart(2, '0')
      const ss = String(now.getSeconds()).padStart(2, '0')
      const base = `速记 ${mm}${dd}-${hh}${mi}${ss}`
      let name = `${base}.md`
      for (let i = 2; fs.existsSync(path.join(this.dir, name)); i++) {
        name = `${base}-${i}.md`
      }
      fs.writeFileSync(path.join(this.dir, name), '', 'utf-8')
      return { ok: true, name }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  read(name: string): { ok: true; content: string; hash: string } | { ok: false; error: string } {
    try {
      const content = fs.readFileSync(this.resolve(name), 'utf-8')
      return { ok: true, content, hash: contentHash(content) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  write(name: string, content: string): { ok: boolean; hash?: string; error?: string } {
    try {
      const abs = this.resolve(name)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, content, 'utf-8')
      return { ok: true, hash: contentHash(content) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 永久删除草稿文件（草稿语义：不进回收站） */
  remove(name: string): { ok: boolean; error?: string } {
    try {
      fs.rmSync(this.resolve(name), { force: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 草稿引用到的图片资产（content 中的 assets/… 引用） */
  assetsFor(content: string): string[] {
    const refs = new Set<string>()
    for (const m of content.matchAll(/assets\/[^)\s"']+/g)) refs.add(m[0])
    return [...refs]
  }

  /** 读取草稿资产文件的 base64（转正随迁用） */
  assetBase64(ref: string): string | null {
    try {
      return fs.readFileSync(this.resolve(ref)).toString('base64')
    } catch {
      return null
    }
  }

  /** 删除草稿引用的资产文件（转正随迁后清理） */
  removeAsset(ref: string): void {
    try {
      fs.rmSync(this.resolve(ref), { force: true })
    } catch {
      /* 忽略清理失败 */
    }
  }

  /**
   * 草稿内粘贴 / 拖入图片：存入 scratch/assets/，返回相对引用 `assets/唯一文件名`。
   * （草稿无库附件目录；转正时随迁到目标库并改写引用路径。）
   */
  saveImage(fileName: string, base64: string): { ok: boolean; error?: string; reference?: string } {
    try {
      const assets = path.join(this.dir, SCRATCH_ASSETS_DIR)
      fs.mkdirSync(assets, { recursive: true })
      const ext = path.extname(fileName) || '.png'
      const base = path.basename(fileName, ext).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 60) || 'image'
      const unique = `${Date.now()}-${base}${ext.toLowerCase()}`
      fs.writeFileSync(path.join(assets, unique), Buffer.from(base64, 'base64'))
      return { ok: true, reference: `${SCRATCH_ASSETS_DIR}/${unique}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

