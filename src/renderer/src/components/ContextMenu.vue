<template>
  <Teleport to="body">
    <div
      v-if="app.contextMenu"
      ref="menuEl"
      class="context-menu"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @contextmenu.prevent
    >
      <template v-for="(item, i) in app.contextMenu.items" :key="i">
        <div v-if="item.divided && i > 0" class="cm-sep"></div>
        <button
          class="cm-item"
          :class="{ 'cm-danger': item.danger, 'cm-disabled': item.disabled }"
          :disabled="item.disabled"
          @click="run(item)"
        >
          <span class="cm-label">{{ item.label }}</span>
          <span v-if="item.hint" class="cm-hint">{{ item.hint }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 右键上下文菜单（FR-2.4.28）：全局单例自绘浮层（设计文档 §4）。
 * - 无进入动画（跟手优先）；执行任一动作 / Esc / 点击菜单外 / 窗口失焦即关闭；
 * - Esc 只关菜单自己——不进 hasModalOpen 模态链（瞬态交互，不影响分级回退），
 *   在 window capture 阶段消费避免落进应用级 keydown；
 * - 定位翻转在打开时计算一次（placeMenu，lib 纯函数）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../stores/app'
import { placeMenu, type MenuItemVM } from '../lib/contextMenu'

const app = useAppStore()
const menuEl = ref<HTMLElement | null>(null)
const adjusted = ref({ x: 0, y: 0 })

const pos = computed(() => adjusted.value)

/** 打开时按菜单实际尺寸做视口翻转钳制（measure 后再定坐标，避免估算误差） */
watch(
  () => app.contextMenu,
  async (v) => {
    if (!v) return
    adjusted.value = { x: v.x, y: v.y }
    await nextTick()
    const el = menuEl.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    adjusted.value = placeMenu(v.x, v.y, rect.width, rect.height, window.innerWidth, window.innerHeight)
  }
)

function run(item: MenuItemVM): void {
  if (item.disabled) return
  app.closeContextMenu()
  item.action()
}

function onKeydown(e: KeyboardEvent): void {
  if (!app.contextMenu) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    app.closeContextMenu()
  }
}

/** 点击菜单外关闭（capture 阶段先于其他 handler，不干扰后续交互） */
function onMousedown(e: MouseEvent): void {
  if (!app.contextMenu) return
  if (menuEl.value?.contains(e.target as Node)) return
  app.closeContextMenu()
}

function onBlur(): void {
  if (app.contextMenu) app.closeContextMenu()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('mousedown', onMousedown, true)
  window.addEventListener('blur', onBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('mousedown', onMousedown, true)
  window.removeEventListener('blur', onBlur)
})
</script>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 3100; /* 高于悬浮预览置顶态 3000（预览开着也可右键），瞬态顶层交互 */
  min-width: 180px;
  max-width: 280px;
  padding: 4px;
  background: var(--el-bg-color-overlay, var(--bg-primary));
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14), 0 1px 4px rgba(0, 0, 0, 0.08);
  user-select: none;
}
.cm-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-color);
}
.cm-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  font-size: 12.5px;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}
.cm-item:hover:not(.cm-disabled) {
  background: var(--bg-hover);
}
.cm-item.cm-disabled {
  color: var(--text-tertiary);
  cursor: default;
  opacity: 0.55;
}
.cm-item.cm-danger {
  color: var(--danger);
}
.cm-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-hint {
  flex: none;
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
