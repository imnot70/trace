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
</script>

<template>
  <el-dialog
    v-model="dialog.visible"
    :title="dialog.title"
    width="420px"
    :close-on-click-modal="false"
    append-to-body
    @opened="onOpened"
  >
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
    <div v-if="dialog.error" class="dialog-error">{{ dialog.error }}</div>
    <template #footer>
      <el-button @click="dialog.visible = false">取消</el-button>
      <el-button type="primary" :loading="dialog.busy" @click="dialog.confirm()">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.desc-input {
  margin-top: 10px;
}

.dialog-error {
  color: var(--danger);
  font-size: 12px;
  margin-top: 8px;
}
</style>
