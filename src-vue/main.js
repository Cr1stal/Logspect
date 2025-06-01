import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'

const app = createApp(App)

// Create and use Pinia store
const pinia = createPinia()
app.use(pinia)

// Enable Vue DevTools in development
if (process.env.NODE_ENV === 'development') {
  app.config.devtools = true
  // Make Vue DevTools work in Electron
  if (window.process && window.process.type === 'renderer') {
    app.config.devtools = true
  }
}

app.mount('#app')