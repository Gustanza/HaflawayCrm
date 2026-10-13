<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login, signup } from '../store.js'

const router = useRouter()
const route = useRoute()
const mode = ref('login')
const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

const MESSAGES = {
  'auth/invalid-credential': 'Please check your email and password. If you still can\'t log in, contact your administrator.',
  'auth/email-already-in-use': 'An account with this email already exists. Log in instead.',
  'auth/weak-password': 'Your password must be at least 6 characters.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase. Enable it under Authentication → Sign-in method.',
  'auth/configuration-not-found': 'Firebase Authentication is not set up yet. Open the Firebase console → Authentication → Get started, then enable Email/Password.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
}

async function submit() {
  error.value = ''
  if (mode.value === 'signup' && !name.value.trim()) return (error.value = 'Enter your name.')
  busy.value = true
  try {
    if (mode.value === 'login') await login(email.value.trim(), password.value)
    else await signup(name.value.trim(), email.value.trim(), password.value)
    const r = route.query.redirect
    router.replace(typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/')
  } catch (e) {
    error.value = MESSAGES[e.code] || e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-wrap">
      <div class="brand">
        <svg width="96" height="66" viewBox="0 0 40 28" aria-hidden="true">
          <path d="M11 26a9 9 0 0 1-1.6-17.9A10 10 0 0 1 28.6 6 8 8 0 1 1 31 26z" fill="#0176d3" />
          <text x="20" y="20" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="Segoe UI, Arial">HC</text>
        </svg>
        <div class="brand-name">HaflaCREM</div>
      </div>
      <form class="login-card" @submit.prevent="submit">
        <div v-if="error" class="login-error">{{ error }}</div>
        <template v-if="mode === 'signup'">
          <label for="name">Full Name</label>
          <input id="name" v-model="name" class="input" autocomplete="name" />
        </template>
        <label for="email">Email</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
        <label for="password">Password</label>
        <input id="password" v-model="password" class="input" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" required />
        <button class="btn btn-brand login-btn" :disabled="busy">
          {{ busy ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Create Account' }}
        </button>
        <div class="switch">
          <template v-if="mode === 'login'">New here? <button type="button" class="link-btn" @click="mode = 'signup'; error = ''">Create an account</button></template>
          <template v-else>Already have an account? <button type="button" class="link-btn" @click="mode = 'login'; error = ''">Log in</button></template>
        </div>
      </form>
      <p class="foot">© {{ new Date().getFullYear() }} HaflaCREM</p>
    </div>
  </div>
</template>

<style scoped>
.login-page { min-height: 100vh; background: #f3f3f3; display: flex; justify-content: center; padding: 64px 16px; }
.login-wrap { width: 100%; max-width: 380px; }
.brand { text-align: center; margin-bottom: 24px; }
.brand-name { font-size: 22px; font-weight: 300; margin-top: 4px; }
.login-card { background: #fff; border: 1px solid #d8dde6; border-radius: 4px; padding: 20px; display: flex; flex-direction: column; }
.login-card label { font-size: 13px; color: #54698d; margin: 12px 0 6px; }
.login-card label:first-of-type { margin-top: 0; }
.login-card .input { height: 40px; }
.login-btn { height: 44px; margin-top: 20px; font-size: 15px; width: 100%; }
.login-error { background: #fddde3; color: #8e030f; border-radius: 4px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; }
.switch { margin-top: 16px; text-align: center; font-size: 13px; }
.foot { text-align: center; margin-top: 24px; color: var(--text-weak); font-size: 12px; }
</style>
