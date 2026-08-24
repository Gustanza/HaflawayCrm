import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'

/**
 * Boot with a hard failure boundary.
 *
 * Firebase configuration is validated at module scope in src/firebase/app.js, so a missing
 * env var throws before Vue ever mounts. Unguarded, that is a blank white page with the
 * explanation buried in the console — which no field agent will ever open.
 */
async function boot() {
  const [{ default: App }, { default: router }, { default: i18n }] = await Promise.all([
    import('./App.vue'),
    import('./router/index.js'),
    import('./i18n.js'),
  ])

  const app = createApp(App)

  // Catch anything a component throws at runtime rather than letting it blank the screen.
  app.config.errorHandler = (error, instance, info) => {
    // eslint-disable-next-line no-console
    console.error('[Haflaway CRM]', info, error)
  }

  app.use(createPinia())
  app.use(i18n)
  app.use(router)
  app.mount('#app')
}

function renderStartupFailure(error) {
  // eslint-disable-next-line no-console
  console.error('[Haflaway CRM] startup failed:', error)
  const root = document.getElementById('app')
  if (!root) return
  // Deliberately plain DOM and inline styles: whatever failed may include the stylesheet
  // or the i18n bundle, so this must depend on nothing.
  root.innerHTML = `
    <div style="min-height:100dvh;display:grid;place-items:center;padding:1.5rem;
                font-family:system-ui,sans-serif;color:#0f172a;text-align:center">
      <div style="max-width:28rem">
        <h1 style="font-size:1.125rem;font-weight:600;margin:0 0 .5rem">
          Programu haikuweza kuanza / The app could not start
        </h1>
        <p style="font-size:.875rem;color:#475569;margin:0 0 1rem">
          Kuna tatizo la mipangilio. Wasiliana na msimamizi wako.<br />
          There is a configuration problem. Contact your administrator.
        </p>
        <button onclick="location.reload()"
                style="min-height:2.75rem;padding:0 1rem;border:0;border-radius:.5rem;
                       background:#4f46e5;color:#fff;font-size:.875rem;font-weight:500">
          Jaribu tena / Try again
        </button>
      </div>
    </div>`
}

boot().catch(renderStartupFailure)
