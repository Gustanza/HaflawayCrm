<script setup>
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { store, dismissToast } from './store.js'
import GlobalHeader from './components/GlobalHeader.vue'
import NavBar from './components/NavBar.vue'
import Icon from './components/Icon.vue'
import SmsPrompts from './components/SmsPrompts.vue'

const route = useRoute()
const router = useRouter()

// Session ended (logout in another tab, token revoked): send the user back to login.
watch(() => store.user, (u) => {
  if (!u && store.authReady && !route.meta.public) router.replace({ name: 'login' })
})
</script>

<template>
  <RouterView v-if="route.meta.public" />
  <template v-else-if="store.user">
    <div class="app-chrome">
      <GlobalHeader />
      <NavBar />
    </div>
    <main>
      <div v-if="store.error" class="page" style="padding-bottom: 0">
        <div class="alert error"><Icon name="warning" /> {{ store.error }}</div>
      </div>
      <div v-if="!store.loaded" class="center-fill"><div class="spinner" /></div>
      <RouterView v-else :key="route.fullPath.split('?')[0]" />
    </main>
    <SmsPrompts />
  </template>

  <div class="toasts">
    <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.variant" role="status">
      <Icon :name="t.variant === 'success' ? 'check' : t.variant === 'error' ? 'warning' : 'info'" :size="20" />
      <span>{{ t.message }}</span>
      <button class="btn-icon bare small" aria-label="Close" @click="dismissToast(t.id)"><Icon name="close" /></button>
    </div>
  </div>
</template>

<style scoped>
.app-chrome { position: sticky; top: 0; z-index: 40; }
</style>
