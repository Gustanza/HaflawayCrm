/**
 * Initials and avatar colour from a display name.
 *
 * Tones are 800/900 text on 100 fills so they clear 4.5:1 on the tinted chip —
 * colour is decoration here; the letters are the signal.
 */
export const AVATAR_TONES = Object.freeze([
  'bg-brand-100 text-brand-800',
  'bg-violet-100 text-violet-900',
  'bg-fuchsia-100 text-fuchsia-900',
  'bg-sky-100 text-sky-900',
  'bg-teal-100 text-teal-900',
  'bg-amber-100 text-amber-900',
])

export function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function avatarToneFromSeed(seed) {
  const s = String(seed || '')
  let hash = 0
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) | 0
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]
}
