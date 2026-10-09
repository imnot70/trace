<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useNameDialog } from '../stores/nameDialog'

const dialog = useNameDialog()
const inputRef = ref<{ focus: () => void } | null>(null)

/** 对话框开启动画结束后聚焦输入框（visible 变化时输入框可能尚未完成挂载/可见，聚焦会失效） */
async function onOpened(): Promise<void> {
  await nextTick()
  inputRef.value?.focus()
}

function onKeydown(e: Event): void {
  if ((e as KeyboardEvent).key === 'Enter') void dialog.confirm()
}

/** 浏览目录（FR-2.1.4）：系统目录选择对话框，取消保持原选择 */
async function browse(): Promise<void> {
  const dir = await window.trace.pickDirectory('选择笔记库目录（GitHub clone 的仓库目录即可）')
  if (dir) dialog.pickedDir = dir
}
</script>

<template>
  <el-dialog
    v-model="dialog.visible"
    :title="dialog.title"
    width="440px"
    :close-on-click-modal="false"
    append-to-body
    @opened="onOpened"
  >
    <!-- 打开已有笔记库标签页（FR-2.1.4）：仅创建笔记库弹窗显示 -->
    <el-tabs v-if="dialog.withOpenTab" v-model="dialog.tab" class="vault-dialog-tabs">
      <el-tab-pane label="创建笔记库" name="create" />
      <el-tab-pane label="打开已有笔记库" name="open" />
    </el-tabs>

    <template v-if="!dialog.withOpenTab || dialog.tab === 'create'">
      <el-input
        ref="inputRef"
        v-model="dialog.inputValue"
        :placeholder="dialog.placeholder"
        :disabled="dialog.busy"
        maxlength="120"
        clearable
        @keydown="onKeydown"
      />
      <el-input
        v-if="dialog.withDescription"
        v-model="dialog.descValue"
        class="desc-input"
        placeholder="描述（可选）"
        :disabled="dialog.busy"
        maxlength="20"
        show-word-limit
        clearable
      />
    </template>

    <template v-else>
      <div class="open-hint">
        选择已 clone 到本地的笔记仓库目录（工作区之外也可以）。Trace 只登记位置、不移动文件；
        若目录是 Git 仓库会自动识别远程仓库，登录账号后即可直接同步。
      </div>
      <div class="open-row">
        <el-input
          :model-value="dialog.pickedDir"
          readonly
          placeholder="尚未选择目录"
          :disabled="dialog.busy"
          class="open-path"
        />
        <el-button :disabled="dialog.busy" @click="browse">浏览…</el-button>
      </div>
    </template>

    <div v-if="dialog.error" class="dialog-error">{{ dialog.error }}</div>
    <template #footer>
      <el-button @click="dialog.visible = false">取消</el-button>
      <el-button type="primary" :loading="dialog.busy" @click="dialog.confirm()">
        {{ dialog.withOpenTab && dialog.tab === 'open' ? '打开' : '确定' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.vault-dialog-tabs {
  margin-bottom: 12px;
}

.vault-dialog-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.desc-input {
  margin-top: 10px;
}

.open-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 10px;
}

.open-row {
  display: flex;
  gap: 8px;
}

.open-row .open-path {
  flex: 1;
}

:deep(.open-path .el-input__inner) {
  text-overflow: ellipsis;
}

.dialog-error {
  color: var(--danger);
  font-size: 12px;
  margin-top: 8px;
}
</style>
