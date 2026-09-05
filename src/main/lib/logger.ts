import fs from 'node:fs'
import path from 'node:path'

type Level = 'info' | 'warn' | 'error'

const MAX_LOG_SIZE = 1024 * 1024

let logFile: string | null = null

export function initLogger(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'main.log')
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_SIZE) {
      fs.renameSync(logFile, path.join(dir, 'main.old.log'))
    }
  } catch {
    logFile = null
  }
}

function write(level: Level, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${args
    .map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`
  if (level === 'error') console.error(line.trim())
  else console.log(line.trim())
  if (logFile) {
    try {
      fs.appendFileSync(logFile, redact(line))
    } catch {
      /* 忽略日志写入失败 */
    }
  }
}

/** 脱敏：防止 token 出现在日志里 */
function redact(text: string): string {
  return text
    .replace(/x-access-token:[^@'"\s]+/g, 'x-access-token:***')
    .replace(/AUTHORIZATION: basic [^\s'"]+/gi, 'AUTHORIZATION: basic ***')
    .replace(/ghp_[A-Za-z0-9_]+/g, 'ghp_***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***')
}

export const logger = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args)
}
