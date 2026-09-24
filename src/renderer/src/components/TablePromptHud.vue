<script setup lang="ts">
/**
 * 表格尺寸输入浮层（FR-2.4.20）：跟随光标定位，实时回显将插入的行列数、操作提示与
 * 「按空格会发生什么」——用户输入过程中随时能确认自己输的对不对。
 * 位置由编辑器（coordsAtPos）给出，绝对定位在编辑卡片内；不使用 tooltip / popper 机制。
 * 无倒计时：浮层会一直等用户输入数字、按空格 / 回车确认或 Esc 取消。
 */
import { computed } from 'vue'
import { useTablePromptStore } from '../stores/tablePrompt'
import { promptText } from '../lib/tablePrompt'

const prompt = useTablePromptStore()

const text = computed(() => promptText(prompt.prompt))
const style = computed(() => ({
  left: `${prompt.anchor.x}px`,
  top: `${prompt.anchor.y}px`
}))
</script>

<template>
  <div v-if="prompt.active" class="table-prompt" :class="{ above: prompt.anchor.above }" :style="style">
    <div class="table-prompt-head">
      <span class="table-prompt-title">插入表格</span>
      <span class="table-prompt-dims">{{ text.dims }}</span>
    </div>
    <div class="table-prompt-hint">{{ text.hint }}</div>
    <div class="table-prompt-footer" :class="{ warn: !!prompt.warning }">
      {{ prompt.warning ?? text.footer }}
    </div>
  </div>
</template>

<style scoped>
.table-prompt {
  position: absolute;
  z-index: 12;
  transform: translateY(6px);
  min-width: 222px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
}

/* 光标贴近卡片底部时翻到上方显示 */
.table-prompt.above {
  transform: translateY(calc(-100% - 6px));
}

.table-prompt-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.table-prompt-title {
  color: var(--text-tertiary);
}

.table-prompt-dims {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.table-prompt-hint {
  margin-top: 2px;
  color: var(--text-secondary);
}

.table-prompt-footer {
  margin-top: 2px;
  color: var(--text-tertiary);
}

.table-prompt-footer.warn {
  color: var(--danger);
}
</style>
