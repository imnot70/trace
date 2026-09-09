<script setup lang="ts">
/**
 * 带悬浮提示的图标按钮（编辑器工具栏用）。
 * 与顶栏的 el-tooltip 风格一致；点击等属性透传到内部按钮。
 */
defineOptions({ name: 'TipButton', inheritAttrs: false })

defineProps<{ tip: string }>()
</script>

<template>
  <el-tooltip :content="tip" placement="bottom" :show-after="300" :hide-after="0">
    <button class="tool-btn" type="button" v-bind="$attrs">
      <slot />
    </button>
  </el-tooltip>
</template>
