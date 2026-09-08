import { describe, expect, it } from 'vitest'
import { errMessage } from '../src/main/lib/errMessage'

describe('git 网络错误友好化', () => {
  it('DNS 解析失败', () => {
    const e = new Error('fatal: unable to access \'https://github.com/a/b.git/\': Could not resolve host: github.com')
    expect(errMessage(e)).toContain('无法解析 GitHub 地址')
  })

  it('连接失败', () => {
    const e = new Error('fatal: unable to access \'https://github.com/a/b.git/\': Failed to connect to github.com port 443')
    expect(errMessage(e)).toContain('无法连接到 GitHub')
  })

  it('连接超时', () => {
    const e = new Error('fatal: unable to access \'https://github.com/a/b.git/\': Connection timed out after 60001 milliseconds')
    expect(errMessage(e)).toContain('超时')
  })

  it('连接中断（SSL/RPC）', () => {
    const e = new Error('fatal: the remote end hung up unexpectedly; RPC failed; curl 56 OpenSSL SSL_read')
    expect(errMessage(e)).toContain('网络连接中断')
  })

  it('认证失败', () => {
    const e = new Error('remote: Invalid username or password. fatal: Authentication failed for \'https://github.com/a/b.git/\'')
    expect(errMessage(e)).toContain('认证失败')
  })

  it('仓库不存在', () => {
    const e = new Error('fatal: repository \'https://github.com/a/b.git/\' not found')
    expect(errMessage(e)).toContain('远程仓库不存在')
  })

  it('普通错误不受影响', () => {
    expect(errMessage(new Error('笔记库不存在'))).toBe('笔记库不存在')
  })
})
