<script setup>
// One SMS draft awaiting its owner's decision: Send as is, Edit the text or number first, or Cancel.
import { ref, computed } from 'vue'
import Icon from './Icon.vue'
import ObjectIcon from './ObjectIcon.vue'
import { sendSms, cancelSms, toast } from '../store.js'
import { smsParts, normalizePhone, formatPhone, inQuietHours } from '../smsText.js'
import { timeAgo, dateTime } from '../format.js'

const props = defineProps({ draft: Object, dismissible: Boolean })
const emit = defineEmits(['dismiss', 'navigate'])

const d = computed(() => props.draft)
const text = ref(d.value.sentContent || d.value.content)
const phone = ref(formatPhone(d.value.sentPhone || d.value.phone))
const editing = ref(!d.value.phoneValid) // no usable number on the record: open the editor straight away
const quietChoice = ref(false)
const busy = ref(false)

const parts = computed(() => smsParts(text.value))
const phoneOk = computed(() => !!normalizePhone(phone.value))
const canSend = computed(() => !busy.value && text.value.trim() && phoneOk.value && ['pending', 'failed'].includes(d.value.status))
const hoursLeft = computed(() => Math.max(0, Math.ceil((d.value.expiresAt - Date.now()) / 3600000)))

async function send(when) {
  if (!when && inQuietHours()) return (quietChoice.value = true)
  quietChoice.value = false
  busy.value = true
  try {
    const res = await sendSms(d.value.id, { content: text.value, phone: phone.value, when })
    toast(res.status === 'scheduled' ? `SMS scheduled for ${dateTime(res.scheduledFor)}.` : `SMS sent to ${d.value.recipientName || formatPhone(normalizePhone(phone.value))}.`)
  } catch (e) {
    if (e.details?.reason === 'quiet-hours') quietChoice.value = true
    else toast(e.message, 'error')
  } finally {
    busy.value = false
  }
}

async function cancel() {
  busy.value = true
  try {
    await cancelSms(d.value.id)
    toast('SMS cancelled. Nothing was sent.', 'info')
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="sms-card" :class="d.status">
    <div class="sms-head">
      <ObjectIcon :object="d.relatedType" size="small" />
      <div class="sms-title">
        <RouterLink :to="`/o/${d.relatedType}/${d.relatedId}`" class="truncate" @click="emit('navigate')">{{ d.recordName || 'Record' }}</RouterLink>
        <span class="muted small">{{ d.label }} · {{ timeAgo(d.createdAt) }}</span>
      </div>
      <button v-if="dismissible" class="btn-icon bare small" title="Later (stays in your SMS inbox)" aria-label="Hide for now" @click="emit('dismiss')">
        <Icon name="close" :size="14" />
      </button>
    </div>

    <div class="sms-to small">
      <span class="muted">To</span>
      <strong>{{ d.recipientName || 'Client' }}</strong>
      <span v-if="!editing" :class="{ bad: !phoneOk }">{{ phone || 'no number' }}</span>
    </div>

    <template v-if="editing">
      <input v-model="phone" class="input" :class="{ invalid: phone && !phoneOk }" inputmode="tel" placeholder="07XX XXX XXX" aria-label="Phone number" />
      <div v-if="!phoneOk" class="form-error">{{ d.phoneValid || phone ? 'Enter a valid Tanzanian mobile number.' : 'This record has no mobile number. Enter one to send.' }}</div>
      <textarea v-model="text" class="textarea" rows="4" aria-label="Message" />
    </template>
    <p v-else class="sms-text">{{ text }}</p>

    <div class="sms-meta small">
      <span :class="{ warn: parts.parts > 1 || parts.unicode }">
        {{ parts.chars }}/{{ parts.limit * parts.parts }} · {{ parts.parts }} SMS<template v-if="parts.unicode"> · emoji/special characters</template>
      </span>
      <span class="spacer" />
      <span v-if="d.status === 'pending'" class="muted">Expires in {{ hoursLeft }}h</span>
    </div>

    <div v-if="d.status === 'failed'" class="sms-status error small"><Icon name="warning" :size="14" /> Not sent: {{ d.error }}</div>
    <div v-if="d.status === 'scheduled'" class="sms-status small"><Icon name="clock" :size="14" /> Will send {{ dateTime(d.scheduledFor) }}</div>
    <div v-if="d.status === 'sending'" class="sms-status small"><span class="mini-spin" /> Sending…</div>

    <div v-if="quietChoice" class="quiet small">
      <span>It's outside sending hours (08:00–20:00).</span>
      <div class="row">
        <button class="btn" :disabled="busy" @click="send('schedule')">Send at 08:00</button>
        <button class="btn" :disabled="busy" @click="send('now')">Send now anyway</button>
      </div>
    </div>
    <div v-else-if="d.status !== 'sending'" class="sms-actions">
      <button class="btn" :disabled="busy" @click="cancel">Cancel</button>
      <button v-if="!editing && d.status !== 'scheduled'" class="btn" :disabled="busy" @click="editing = true"><Icon name="edit" :size="14" /> Edit</button>
      <span class="spacer" />
      <button v-if="d.status !== 'scheduled'" class="btn btn-brand" :disabled="!canSend" @click="send()">
        {{ busy ? 'Sending…' : d.status === 'failed' ? 'Retry' : 'Send' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sms-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--surface); }
.sms-head { display: flex; align-items: center; gap: 8px; }
.sms-title { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.3; }
.sms-title a { font-weight: 700; }
.sms-to { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.sms-to .bad { color: var(--error); }
.sms-text { white-space: pre-wrap; word-break: break-word; background: var(--bg); border-radius: 12px 12px 12px 2px; padding: 8px 10px; }
.input.invalid { border-color: var(--error-bright); }
.sms-meta { display: flex; color: var(--text-weak); }
.sms-meta .warn { color: var(--warning); font-weight: 600; }
.sms-status { display: flex; align-items: center; gap: 6px; color: var(--text-weak); }
.sms-status.error { color: var(--error); }
.sms-actions { display: flex; gap: 8px; }
.quiet { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: var(--radius); background: #fef1c7; color: #8c4b02; }
.quiet .row { flex-wrap: wrap; }
.mini-spin { width: 12px; height: 12px; border: 2px solid #d8e6fe; border-top-color: var(--brand); border-radius: 50%; animation: spin .8s linear infinite; }
</style>
