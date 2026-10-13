import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router.js'
import { toast } from './store.js'

window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Something went wrong.', 'error'))

createApp(App).use(router).mount('#app')
