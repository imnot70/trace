import fs from 'node:fs'
import path from 'node:path'

/** 简单的原子写入 JSON 持久化 */
export class JsonStore<T extends object> {
  private data: T

  constructor(
    private filePath: string,
    defaults: T
  ) {
    this.data = this.load(defaults)
  }

  private load(defaults: T): T {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      return { ...structuredClone(defaults), ...JSON.parse(raw) }
    } catch {
      return structuredClone(defaults)
    }
  }

  get(): T {
    return this.data
  }

  update(mutate: (data: T) => void): T {
    mutate(this.data)
    this.save()
    return this.data
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
    fs.renameSync(tmp, this.filePath)
  }
}
