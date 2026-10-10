import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'katex/dist/katex.min.css'
// MiSans 字体（FR-2.9.13 P0）：misans npm 包的子集 woff2（unicode-range 按需加载），
// 二进制不入库走依赖——Regular(400) / Medium(500) / Demibold(600) 三字重覆盖 UI 全部字重
import 'misans/lib/Normal/MiSans-Regular.min.css'
import 'misans/lib/Normal/MiSans-Medium.min.css'
import 'misans/lib/Normal/MiSans-Demibold.min.css'
import './styles/main.css'
import './styles/themes.css'
import './styles/markdown.css'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
// 图标：EP 全局图标注册已移除，统一改用 lucide-vue-next（FR-2.9.13 P0 图标批次）——
// 各组件按需具名导入，模板内以 EP 旧名作别名（如 Trash2 as Delete）保持零模板改动；
// 尺寸沿用字号驱动：main.css 的 .lucide { width/height: 1em }
app.mount('#app')
