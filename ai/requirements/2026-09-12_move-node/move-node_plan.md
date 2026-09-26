# 文件/文件夹移动实施计划

> 基于 `move-node_design.md`，预计总工作量：1 天。

---

## 已完成

任务 1~6（基础移动功能）已全部实施并验证通过。

---

## 待实施：移动后相对路径引用改写

### 任务 7：`rewriteReferences` 方法

**文件**：`src/main/services/fsTree.ts`

新增私有方法 `rewriteReferences(vault, srcPath, kind, newPath)`，在 `moveNode` 的 `fs.renameSync` 成功后调用：

1. 收集需改写的笔记：
   - 移动笔记 → 仅该笔记（读取 `srcAbs` 内容）
   - 移动文件夹 → 递归遍历目录下所有 `.md` 文件
2. 对每个笔记：
   - 读取内容
   - 正则匹配所有相对路径引用（`![...](path)`、`[...](path)`、`<img src="path">`）
   - 跳过绝对 URL（`http://` 等）、库根路径（`/` 开头）、锚点（`#`）
   - 对每个引用：
     - 用 `resolveRelRef`（从 `paths.ts`）基于笔记**旧位置**解析为库内绝对路径
     - 检查该绝对路径是否在 `srcPath` 目录树内 → 在则跳过（相对关系不变）
     - 不在 → 用 `relReference` 基于笔记**新位置**重新计算相对路径 → 替换
   - 写回内容
3. 错误处理：单个笔记读写失败不阻塞整体移动，仅记日志

**验证**：`npm run typecheck` 通过。

---

### 任务 8：引用改写测试

**文件**：`tests/services.test.ts`

补充测试：

- 移动笔记后改写图片引用（`./attachments/x.png` → `../attachments/x.png`）
- 移动笔记后改写链接引用（`./other.md` → `../other.md`）
- 移动笔记后不改写同目录树内引用（相对关系不变）
- 移动文件夹后批量改写内部笔记引用
- 不改写绝对 URL 和锚点
- HTML img 标签的 src 同样改写

**验证**：`npm test` 通过。

---

### 任务 9：文档同步

1. `CHANGELOG.md`：更新移动功能描述，增加「自动改写相对路径引用」
2. `requirements/index.md`：更新状态

---

## 执行顺序

任务 7 → 任务 8 → 任务 9

## 验证命令

```bash
npm run typecheck
npm test
```
