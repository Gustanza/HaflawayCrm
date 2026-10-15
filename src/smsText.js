// Client-side SMS helpers for the approval box. functions/sms.js has the server's copies of the phone and
// quiet-hours rules; keep the two in step.

const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXT = '^{}\\[~]|€\f'

// How many SMS parts a message costs. One character outside GSM-7 (emoji, curly quotes) switches the
// whole message to Unicode: 70 characters per SMS instead of 160.
export function smsParts(text) {
  let units = 0
  for (const ch of text) {
    if (GSM.includes(ch)) units += 1
    else if (GSM_EXT.includes(ch)) units += 2
    else {
      const n = text.length
      return { chars: n, unicode: true, limit: 70, parts: n <= 70 ? 1 : Math.ceil(n / 67) }
    }
  }
  return { chars: units, unicode: false, limit: 160, parts: units <= 160 ? 1 : Math.ceil(units / 153) }
}

export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 && d.startsWith('0')) d = '255' + d.slice(1)
  else if (d.length === 9) d = '255' + d
  return /^255[67]\d{8}$/.test(d) ? d : null
}

export const formatPhone = (p) => (/^255\d{9}$/.test(p || '') ? `+255 ${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p || '')

// Sending hours in Tanzania (UTC+3): 08:00–20:00.
export function inQuietHours(now = Date.now()) {
  const h = new Date(now + 3 * 3600000).getUTCHours()
  return h >= 20 || h < 8
}
