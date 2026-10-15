<script setup>
// Bottom-right prompts for SMS drafts created while the app is open (e.g. right after moving a job to
// "Quote Sent"). Hiding one only hides the prompt; the draft stays in the header's SMS inbox.
import { ref, computed } from 'vue'
import SmsCard from './SmsCard.vue'
import { store } from '../store.js'

const since = Date.now() - 60000 // also catch a draft created just before the page loaded
const hidden = ref(new Set())
// Only your own drafts pop up; admins find the team's in the SMS inbox.
const prompts = computed(() => store.sms.filter((d) => d.ownerId === store.user.uid && d.createdAt >= since && !hidden.value.has(d.id) && d.status !== 'scheduled').slice(0, 3))
const hide = (id) => (hidden.value = new Set(hidden.value).add(id))
</script>

<template>
  <div v-if="prompts.length" class="sms-prompts" aria-live="polite">
    <div v-for="d in prompts" :key="d.id" class="prompt">
      <SmsCard :draft="d" dismissible @dismiss="hide(d.id)" />
    </div>
  </div>
</template>

<style scoped>
.sms-prompts { position: fixed; right: 16px; bottom: 16px; z-index: 90; width: 360px; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 120px); overflow-y: auto; }
.prompt { border-radius: 8px; overflow: hidden; box-shadow: 0 4px 16px rgba(0, 0, 0, .2); border-top: 3px solid var(--brand); }
@media (max-width: 640px) { .sms-prompts { left: 8px; right: 8px; bottom: 8px; width: auto; } }
</style>
