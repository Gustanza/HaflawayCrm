<script setup>
/**
 * Progressive disclosure for a list that is grouped or ranked rather than browsed.
 *
 * Where full pagination is wrong: the Work Queue, the Urgency board and a kanban column
 * are all sorted by importance, so page 2 is by definition the least urgent work. Hiding
 * it behind Previous/Next implies the user should navigate there; a "show more" implies
 * they usually should not. Same reason the timeline uses it — nobody pages backwards
 * through a conversation, they occasionally look further back.
 */
defineProps({
  remaining: { type: Number, required: true },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['more'])
</script>

<template>
  <button
    v-if="remaining > 0"
    type="button"
    class="btn-secondary w-full text-sm"
    :disabled="loading"
    @click="emit('more')"
  >
    {{ loading ? $t('common.loading') : $t('list.showMore', { count: remaining }) }}
  </button>
</template>
