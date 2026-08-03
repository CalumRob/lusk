import { createApp } from 'vue'

import '@fontsource-variable/manrope/index.css'
import '@fontsource-variable/newsreader/index.css'

import App from './App.vue'
import router from './router'
import './styles/base.css'
import './styles/tokens.css'

createApp(App).use(router).mount('#app')
