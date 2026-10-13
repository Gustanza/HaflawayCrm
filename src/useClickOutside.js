import { onMounted, onBeforeUnmount } from 'vue'

export function useClickOutside(elRef, handler) {
  const listener = (e) => {
    if (elRef.value && !elRef.value.contains(e.target)) handler(e)
  }
  onMounted(() => document.addEventListener('mousedown', listener))
  onBeforeUnmount(() => document.removeEventListener('mousedown', listener))
}
