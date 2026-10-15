// Default SMS wording. Staff can edit every message before it is sent; these are only the starting text.
// Plain ASCII on purpose: one emoji or curly quote switches the SMS to Unicode (70 chars per part, not 160).

export const LABELS = {
  lead_welcome: 'Welcome',
  quote_sent: 'Quote sent',
  payment_received: 'Payment receipt',
  client_approval: 'Design ready for approval',
  completed: 'Job completed',
}

const tzs = (v) => 'TZS ' + Math.round(Number(v) || 0).toLocaleString('en-US')
const SOMBER = ['Funeral / Msiba', 'Memorial']

// v: { name, owner, service, eventType, amount, paid, balance, payment }
export const TEMPLATES = {
  lead_welcome: (v) =>
    `Habari ${v.name}, asante kwa kuwasiliana na Haflaway! ${v.owner || 'Mhudumu wetu'} atakupigia hivi karibuni kuhusu ${v.service || 'huduma unayohitaji'}. Karibu sana.`,

  quote_sent: (v) =>
    (Number(v.amount) > 0
      ? `Habari ${v.name}, bei ya ${v.service || 'huduma yako'} ni ${tzs(v.amount)}.`
      : `Habari ${v.name}, tumekutumia bei ya ${v.service || 'huduma yako'}.`) +
    ` Lipa amana ili tuanze kazi yako.${v.payment ? ' ' + v.payment : ''} Asante!`,

  payment_received: (v) =>
    `Habari ${v.name}, tumepokea malipo ya ${tzs(v.paid)}. ` +
    (Number(v.balance) > 0 ? `Salio lililobaki ni ${tzs(v.balance)}.` : 'Malipo yako yamekamilika.') + ' Asante!',

  client_approval: (v) =>
    `Habari ${v.name}, rasimu ya ${v.service || 'kazi yako'} iko tayari! Tafadhali iangalie na utujibu ili tuanze kutuma kwa wageni wako.`,

  completed: (v) =>
    (SOMBER.includes(v.eventType)
      ? `Habari ${v.name}, kazi ya ${v.service || 'yako'} imekamilika. Tunashukuru kwa kutuamini katika kipindi hiki.`
      : `Habari ${v.name}, kazi ya ${v.service || 'yako'} imekamilika. Asante kwa kuchagua Haflaway! Karibu tena na uwaambie marafiki.`) +
    (Number(v.balance) > 0 ? ` Salio: ${tzs(v.balance)}.` : ''),
}
