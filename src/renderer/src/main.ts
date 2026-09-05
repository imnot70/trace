import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'katex/dist/katex.min.css'
import './styles/main.css'
import './styles/themes.css'
import './styles/markdown.css'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}
app.mount('#app')
