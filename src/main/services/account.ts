import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { logger } from '../lib/logger'

const TOKEN_FILE = 'account.bin'
const MAGIC = Buffer.from('TRTK01')

interface StoredAccount {
  token: string
  username: string
}

/**
 * GitHub PAT 存储：优先使用 safeStorage（系统钥匙串级加密），
 * 不可用时（部分 Linux 无 libsecret）降级为明文并记录警告。
 */
export class AccountService {
  private cached: StoredAccount | null = null

  constructor(private userDataDir: string) {}

  private get accountFile(): string {
    return path.join(this.userDataDir, TOKEN_FILE)
  }

  save(token: string, username: string): { ok: boolean; error?: string } {
    try {
      fs.mkdirSync(this.userDataDir, { recursive: true })
      const json = JSON.stringify({ token, username })
      let payload: Buffer
      if (safeStorage.isEncryptionAvailable()) {
        payload = Buffer.concat([MAGIC, safeStorage.encryptString(json)])
      } else {
        logger.warn('系统加密不可用，令牌将以明文存储')
        payload = Buffer.concat([MAGIC, Buffer.from(json, 'utf-8')])
      }
      fs.writeFileSync(this.accountFile, payload)
      this.cached = { token, username }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private load(): StoredAccount | null {
    if (this.cached) return this.cached
    try {
      if (!fs.existsSync(this.accountFile)) return null
      const raw = fs.readFileSync(this.accountFile)
      if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) return null
      const body = raw.subarray(MAGIC.length)
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(body) : body.toString('utf-8')
      this.cached = JSON.parse(json) as StoredAccount
      return this.cached
    } catch (e) {
      logger.error('读取账号信息失败', e)
      return null
    }
  }

  getToken(): string | null {
    return this.load()?.token ?? null
  }

  getUsername(): string | null {
    return this.load()?.username ?? null
  }

  clear(): void {
    try {
      fs.rmSync(this.accountFile, { force: true })
    } catch {
      /* ignore */
    }
    this.cached = null
  }

  isLoggedIn(): boolean {
    return this.getToken() !== null
  }
}
