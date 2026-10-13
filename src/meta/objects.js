// Object metadata: drives list views, forms, record pages and search (like Salesforce's Object Manager).

export const CURRENCY = 'TZS'
export const LOCALE = 'en-US'

const DAY = 86400000
// Local date (not UTC). Kept local to avoid a circular import with format.js.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const isMine = (r, user) => r.ownerId === user?.uid
const isRecent = (r) => (r.createdAt || 0) > Date.now() - 7 * DAY

export const LEAD_SOURCES = ['WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Referral', 'Repeat Customer', 'Agent / Partner', 'Event / Kikao', 'Phone Call', 'Walk-in', 'Website', 'Other']
export const SERVICES = ['Kadi za Michango', 'SMS Reminder za Michango', 'Kadi za Mwaliko wa Kamati', 'Save the Date', 'Invitation Card',
  'Invitation + RSVP / QR Check-in', 'Full Package (Michango + Invitations)', 'Thank You Message', 'Other']
export const EVENT_TYPES = ['Wedding', 'Send-off', 'Kitchen Party', 'Engagement', 'Birthday', 'Graduation', 'Funeral / Msiba', 'Memorial', 'Corporate', 'Other']
export const REGIONS = ['Dar es Salaam', 'Arusha', 'Mwanza', 'Dodoma', 'Mbeya', 'Morogoro', 'Zanzibar', 'Tanga', 'Moshi / Kilimanjaro', 'Other Region']

// Job stages for a digital invitation order. Probability feeds the weighted pipeline.
export const WON_STAGE = 'Completed'
export const LOST_STAGE = 'Lost'
export const OPP_STAGES = [
  { value: 'Inquiry', probability: 10 },
  { value: 'Quote Sent', probability: 30 },
  { value: 'Deposit Paid', probability: 70 },
  { value: 'Design', probability: 80 },
  { value: 'Client Approval', probability: 85 },
  { value: 'Sending', probability: 95 },
  { value: WON_STAGE, probability: 100, closed: true, won: true },
  { value: LOST_STAGE, probability: 0, closed: true },
]
export const isClosedStage = (s) => s === WON_STAGE || s === LOST_STAGE
// A job is "committed" once the client paid a deposit; only then does an unpaid balance count as owed.
const COMMITTED_FROM = OPP_STAGES.findIndex((s) => s.value === 'Deposit Paid')
export const isCommitted = (s) => s !== LOST_STAGE && OPP_STAGES.findIndex((x) => x.value === s) >= COMMITTED_FROM
export const owes = (r) => isCommitted(r.stage) && Number(r.balance) > 0

// Calendar status colors: validated categorical slots in stage order (dataviz reference palette).
// NEUTRAL marks inactive states (Unqualified / Lost) and is drawn dashed as a second cue.
export const NEUTRAL = '#8a8886'
const CAL = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', magenta: '#e87ba4', green: '#008300', violet: '#6250d6' }

export const OBJECTS = {
  leads: {
    key: 'leads',
    label: 'Lead',
    plural: 'Leads',
    color: '#f88962',
    icon: 'lead',
    nameOf: (r) => [r.firstName, r.lastName].filter(Boolean).join(' '),
    searchFields: ['firstName', 'lastName', 'company', 'email', 'phone'],
    fields: [
      { key: 'firstName', label: 'First Name', type: 'text' },
      { key: 'lastName', label: 'Last Name', type: 'text', required: true },
      { key: 'company', label: 'Event / Client Name', type: 'text', required: true },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'phone' },
      { key: 'status', label: 'Lead Status', type: 'picklist', required: true, default: 'New',
        options: ['New', 'Working', 'Nurturing', 'Unqualified', 'Converted'] },
      { key: 'source', label: 'Lead Source', type: 'picklist', options: LEAD_SOURCES },
      { key: 'rating', label: 'Rating', type: 'picklist', options: ['Hot', 'Warm', 'Cold'] },
      { key: 'eventType', label: 'Event Type', type: 'picklist', options: EVENT_TYPES },
      { key: 'eventDate', label: 'Event Date', type: 'date' },
      { key: 'service', label: 'Service Interested In', type: 'picklist', options: SERVICES },
      { key: 'guests', label: 'Number of Guests', type: 'number' },
      { key: 'region', label: 'Region', type: 'picklist', options: REGIONS },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    listColumns: ['name', 'company', 'phone', 'eventType', 'eventDate', 'status', 'ownerName'],
    highlights: ['company', 'phone', 'eventType', 'eventDate', 'ownerName'],
    path: { field: 'status', stages: ['New', 'Working', 'Nurturing', 'Converted'] },
    calendar: {
      dateField: 'eventDate',
      colorField: 'status',
      colors: { New: CAL.blue, Working: CAL.orange, Nurturing: CAL.aqua, Converted: CAL.green, Unqualified: NEUTRAL },
      detail: (r) => [r.eventType, r.service].filter(Boolean).join(' · '),
    },
    listViews: [
      { key: 'open', label: 'Open Leads', filter: (r) => !['Converted', 'Unqualified'].includes(r.status) },
      { key: 'mine', label: 'My Open Leads', filter: (r, u) => isMine(r, u) && !['Converted', 'Unqualified'].includes(r.status) },
      { key: 'all', label: 'All Leads', filter: () => true },
      { key: 'recent', label: 'Recently Created', filter: isRecent },
      { key: 'converted', label: 'Converted Leads', filter: (r) => r.status === 'Converted' },
    ],
  },

  accounts: {
    key: 'accounts',
    label: 'Account',
    plural: 'Accounts',
    color: '#5867e8',
    icon: 'account',
    nameOf: (r) => r.name,
    searchFields: ['name', 'phone', 'website', 'city'],
    fields: [
      { key: 'name', label: 'Account Name', type: 'text', required: true },
      { key: 'type', label: 'Type', type: 'picklist', options: ['Prospect', 'Customer', 'Event Planner', 'Partner', 'Other'] },
      { key: 'eventType', label: 'Event Type', type: 'picklist', options: EVENT_TYPES },
      { key: 'eventDate', label: 'Event Date', type: 'date' },
      { key: 'phone', label: 'Phone', type: 'phone' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'region', label: 'Region', type: 'picklist', options: REGIONS },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    listColumns: ['name', 'type', 'eventType', 'eventDate', 'phone', 'ownerName'],
    highlights: ['type', 'eventType', 'eventDate', 'phone', 'ownerName'],
    related: [
      { object: 'contacts', field: 'accountId', columns: ['name', 'title', 'email', 'phone'] },
      { object: 'opportunities', field: 'accountId', columns: ['name', 'service', 'stage', 'amount', 'balance'] },
    ],
    listViews: [
      { key: 'all', label: 'All Accounts', filter: () => true },
      { key: 'mine', label: 'My Accounts', filter: isMine },
      { key: 'customers', label: 'Customers', filter: (r) => r.type === 'Customer' },
      { key: 'recent', label: 'Recently Created', filter: isRecent },
    ],
  },

  contacts: {
    key: 'contacts',
    label: 'Contact',
    plural: 'Contacts',
    color: '#a094ed',
    icon: 'contact',
    nameOf: (r) => [r.firstName, r.lastName].filter(Boolean).join(' '),
    searchFields: ['firstName', 'lastName', 'email', 'phone', 'mobile'],
    fields: [
      { key: 'firstName', label: 'First Name', type: 'text' },
      { key: 'lastName', label: 'Last Name', type: 'text', required: true },
      { key: 'accountId', label: 'Account Name', type: 'lookup', object: 'accounts' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'phone' },
      { key: 'mobile', label: 'Mobile', type: 'phone' },
      { key: 'city', label: 'Mailing City', type: 'text' },
      { key: 'source', label: 'Lead Source', type: 'picklist', options: LEAD_SOURCES },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    listColumns: ['name', 'accountId', 'title', 'phone', 'email', 'ownerName'],
    highlights: ['title', 'accountId', 'phone', 'email', 'ownerName'],
    related: [
      { object: 'opportunities', field: 'contactId', label: 'Opportunities (Primary Contact)', columns: ['name', 'service', 'stage', 'amount', 'balance'] },
    ],
    listViews: [
      { key: 'all', label: 'All Contacts', filter: () => true },
      { key: 'mine', label: 'My Contacts', filter: isMine },
      { key: 'recent', label: 'Recently Created', filter: isRecent },
    ],
  },

  opportunities: {
    key: 'opportunities',
    label: 'Opportunity',
    plural: 'Opportunities',
    color: '#fcb95b',
    icon: 'opportunity',
    nameOf: (r) => r.name,
    searchFields: ['name', 'nextStep'],
    fields: [
      { key: 'name', label: 'Opportunity Name', type: 'text', required: true },
      { key: 'accountId', label: 'Account Name', type: 'lookup', object: 'accounts' },
      { key: 'contactId', label: 'Primary Contact', type: 'lookup', object: 'contacts' },
      { key: 'service', label: 'Service', type: 'picklist', required: true, options: SERVICES },
      { key: 'eventType', label: 'Event Type', type: 'picklist', options: EVENT_TYPES },
      { key: 'eventDate', label: 'Event Date', type: 'date' },
      { key: 'guests', label: 'Guests / SMS Recipients', type: 'number' },
      { key: 'amount', label: 'Total Price', type: 'currency' },
      { key: 'amountPaid', label: 'Amount Paid', type: 'currency' },
      { key: 'balance', label: 'Balance', type: 'currency', readonly: true },
      { key: 'closeDate', label: 'Delivery Date', type: 'date', required: true },
      { key: 'stage', label: 'Stage', type: 'picklist', required: true, default: 'Inquiry', options: OPP_STAGES.map((s) => s.value) },
      { key: 'probability', label: 'Probability (%)', type: 'percent', readonly: true },
      { key: 'completedDate', label: 'Completed Date', type: 'date', readonly: true },
      { key: 'source', label: 'Lead Source', type: 'picklist', options: LEAD_SOURCES },
      { key: 'nextStep', label: 'Next Step', type: 'text' },
      { key: 'lostReason', label: 'Lost Reason', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
    ],
    listColumns: ['name', 'service', 'eventDate', 'amount', 'balance', 'stage', 'ownerName'],
    highlights: ['accountId', 'service', 'eventDate', 'amount', 'balance'],
    path: { field: 'stage', stages: OPP_STAGES.map((s) => s.value).filter((s) => s !== LOST_STAGE), closedLabel: 'Done' },
    kanban: { field: 'stage', stages: OPP_STAGES.map((s) => s.value), sumField: 'amount' },
    calendar: {
      dateField: 'eventDate',
      colorField: 'stage',
      colors: {
        Inquiry: CAL.blue, 'Quote Sent': CAL.orange, 'Deposit Paid': CAL.aqua, Design: CAL.yellow,
        'Client Approval': CAL.magenta, Sending: CAL.violet, [WON_STAGE]: CAL.green, [LOST_STAGE]: NEUTRAL,
      },
      detail: (r) => [r.service, r.eventType].filter(Boolean).join(' · '),
    },
    listViews: [
      { key: 'open', label: 'All Open Opportunities', filter: (r) => !isClosedStage(r.stage) },
      { key: 'mine', label: 'My Opportunities', filter: isMine },
      { key: 'all', label: 'All Opportunities', filter: () => true },
      { key: 'closingMonth', label: 'Delivering This Month', filter: (r) => !isClosedStage(r.stage) && (r.closeDate || '').slice(0, 7) === today().slice(0, 7) },
      { key: 'design', label: 'In Design / Approval', filter: (r) => ['Design', 'Client Approval'].includes(r.stage) },
      { key: 'balance', label: 'Unpaid Balances', filter: (r) => owes(r) },
      { key: 'won', label: 'Completed Jobs', filter: (r) => r.stage === WON_STAGE },
    ],
  },

  tasks: {
    key: 'tasks',
    label: 'Task',
    plural: 'Tasks',
    color: '#3ba755',
    icon: 'task',
    nameOf: (r) => r.subject,
    searchFields: ['subject'],
    fields: [
      { key: 'subject', label: 'Subject', type: 'text', required: true },
      { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'picklist', required: true, default: 'Not Started', options: ['Not Started', 'In Progress', 'Completed'] },
      { key: 'priority', label: 'Priority', type: 'picklist', default: 'Normal', options: ['High', 'Normal', 'Low'] },
      { key: 'related', label: 'Related To', type: 'related' },
      { key: 'description', label: 'Comments', type: 'textarea', wide: true },
    ],
    listColumns: ['subject', 'dueDate', 'status', 'priority', 'related', 'ownerName'],
    highlights: ['dueDate', 'status', 'priority', 'related', 'ownerName'],
    listViews: [
      { key: 'open', label: 'Open Tasks', filter: (r) => r.status !== 'Completed' },
      { key: 'today', label: "Today's Tasks", filter: (r) => r.status !== 'Completed' && r.dueDate && r.dueDate <= today() },
      { key: 'overdue', label: 'Overdue Tasks', filter: (r) => r.status !== 'Completed' && r.dueDate && r.dueDate < today() },
      { key: 'mine', label: 'My Tasks', filter: (r, u) => isMine(r, u) && r.status !== 'Completed' },
      { key: 'completed', label: 'Completed Tasks', filter: (r) => r.status === 'Completed' },
      { key: 'all', label: 'All Tasks', filter: () => true },
    ],
  },
}

export const NAV_OBJECTS = ['leads', 'accounts', 'contacts', 'opportunities', 'tasks']
// Objects a task or activity can be related to.
export const RELATABLE = ['leads', 'accounts', 'contacts', 'opportunities']

export function fieldDef(objectKey, fieldKey) {
  const own = OBJECTS[objectKey].fields.find((f) => f.key === fieldKey)
  if (own) return own
  if (fieldKey === 'name') return { key: 'name', label: OBJECTS[objectKey].label + ' Name', type: 'name' }
  if (fieldKey === 'ownerName') return { key: 'ownerName', label: OBJECTS[objectKey].label + ' Owner', type: 'text' }
}

export function recordName(objectKey, r) {
  if (!r) return ''
  return OBJECTS[objectKey]?.nameOf(r) || r.name || r.fullName || r.title || r.email || r.company || '(no name)'
}

export function stageProbability(stage) {
  return OPP_STAGES.find((s) => s.value === stage)?.probability ?? 0
}
