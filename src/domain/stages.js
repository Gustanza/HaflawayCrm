/**
 * Pipeline state machine — TODO.md §5.2.
 *
 * This module and the `allowedNextStages` map in firestore.rules MUST agree. A test in
 * tests/unit/stages.test.js parses the rules file and asserts they match, because a
 * divergence means the UI offers a transition the server will reject — or worse, the
 * server permits one the UI thought impossible.
 */

export const STAGES = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  UNREACHABLE: 'unreachable',
  QUALIFIED: 'qualified',
  QUOTED: 'quoted',
  NEGOTIATION: 'negotiation',
  WON: 'won',
  LOST: 'lost',
  PARKED: 'parked',
  NURTURE: 'nurture',
  DISQUALIFIED: 'disqualified',
})

export const STAGE_LIST = Object.freeze(Object.values(STAGES))

/**
 * Allowed transitions — a COMPLETE graph. Every stage may move to every stage.
 *
 * WHY THIS IS NO LONGER A FUNNEL
 *
 * It used to be the §5.2 ladder: new -> contacted -> qualified -> quoted -> ... , with
 * backwards moves forbidden. That models how a deal is SUPPOSED to progress, and it was
 * wrong about how the data actually gets entered. The move that broke it was the most
 * ordinary one imaginable: an agent taps the wrong column, a lead lands in `contacted`,
 * and nothing in the product can put it back in `new`. The state machine was not
 * preventing a bad deal — it was preventing a correction of a typo, and the only remedy on
 * offer was to create a second lead and abandon the first one's timeline.
 *
 * A pipeline stage is a record of where a deal IS, not a claim about the route it took.
 * The route is already recorded, faithfully and immutably, in the timeline: every move
 * writes a `stage_change` activity naming both ends (P1). That is the honest audit trail,
 * and it survives corrections in a way a locked graph never did.
 *
 * WHAT STILL GUARDS THE DATA
 *
 * Freeing the graph does NOT free the invariants, and this is the distinction that makes
 * the change safe: `STAGE_REQUIREMENTS` below is untouched. You still cannot mark a lead
 * `qualified` without BEDS, `won` without a deal value above zero, `lost` without a reason.
 * Those rules are about DATA being present, not about workflow being obeyed, and they are
 * the ones that were ever load-bearing for §8's analytics.
 *
 * The one remaining gate is on REOPENING — see validateTransition(). Leaving `won`, `lost`
 * or `disqualified` moves revenue and CAC figures that people have already read, so it
 * needs a manager. Entering them needs only the required fields, as before.
 *
 * A stage still includes itself: an update that edits some other field must not be
 * rejected merely for restating the current stage.
 */
export const TRANSITIONS = Object.freeze(
  Object.fromEntries(STAGE_LIST.map((from) => [from, Object.freeze([...STAGE_LIST])])),
)

/**
 * The closed stages.
 *
 * Named "terminal" historically because nothing could leave them. A manager now can — see
 * validateTransition() — but everything else these drive is unchanged: they are what
 * `leadStatusFor` projects to a closed status, what stamps `closedAt`/`closedBy`, and what
 * §8 counts as a finished lead.
 */
export const TERMINAL_STAGES = Object.freeze(['won', 'lost', 'disqualified'])

/** Who may pull a lead back out of a closed stage. */
export const REOPEN_ROLES = Object.freeze(['admin', 'manager'])

/** Stages that count as an open, workable lead. Drives the work queue and pipeline value. */
export const OPEN_STAGES = Object.freeze([
  'new',
  'contacted',
  'unreachable',
  'qualified',
  'quoted',
  'negotiation',
  'nurture',
])

/** The `leadStatus` projection stored on the lead for cheap querying (TODO.md §6.2). */
export function leadStatusFor(stage) {
  if (stage === 'won') return 'closed_won'
  if (stage === 'lost' || stage === 'disqualified') return 'closed_lost'
  if (stage === 'parked') return 'parked'
  return 'open'
}

/**
 * Win probability per stage, for `weightedPipeline` (TODO.md §8.6).
 * These are starting estimates, NOT measurements. Replace them with observed conversion
 * rates once there are twelve months of closed leads — and say so on any forecast chart
 * built from them until you do.
 */
export const STAGE_WIN_PROBABILITY = Object.freeze({
  new: 0.05,
  contacted: 0.1,
  unreachable: 0.02,
  qualified: 0.3,
  quoted: 0.5,
  negotiation: 0.7,
  nurture: 0.08,
  won: 1,
  lost: 0,
  parked: 0.01,
  disqualified: 0,
})

export function isValidStage(stage) {
  return typeof stage === 'string' && STAGE_LIST.includes(stage)
}

export function isTerminal(stage) {
  return TERMINAL_STAGES.includes(stage)
}

export function isOpen(stage) {
  return OPEN_STAGES.includes(stage)
}

/** Every stage reachable from `from`, excluding `from` itself. */
export function nextStages(from) {
  return (TRANSITIONS[from] ?? []).filter((s) => s !== from)
}

export function canTransition(from, to) {
  if (!isValidStage(from) || !isValidStage(to)) return false
  return (TRANSITIONS[from] ?? []).includes(to)
}

/* ---------------------------------------------------------------------------
 * Field requirements per target stage — the §5.2 invariants.
 * ------------------------------------------------------------------------- */

/**
 * What a lead must already have before it may ENTER a stage.
 * `qualified` enforces BEDS (§5.3): budget, event and decision-maker known.
 */
export const STAGE_REQUIREMENTS = Object.freeze({
  qualified: ['qualification.budgetBand', 'eventDate', 'qualification.decisionMakerContactId'],
  quoted: ['dealValueMinor'],
  won: ['dealValueMinor'],
  lost: ['lossReason'],
  parked: ['parkReason'],
})

/**
 * `closedAt` and `closedBy` are deliberately NOT listed above.
 *
 * They are stamped by the server (serverTimestamp + request.auth.uid) at the moment of the
 * write, and firestore.rules `closureFieldsPresent()` is what enforces their presence.
 * Requiring them here made winning or losing a deal IMPOSSIBLE: changeStage() validates
 * before it stamps, so every close failed with "Fill in closedAt, closedBy" — the core
 * path of the product, unreachable, behind a message no user could act on.
 *
 * Rule of thumb: this list holds fields a HUMAN must supply. Anything the system stamps
 * belongs in the rules, not here.
 */

function readPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

function isPresent(value) {
  if (value === null || value === undefined || value === '') return false
  if (value === 'unknown') return false // budgetBand's explicit "not yet established"
  return true
}

/**
 * Full validation of a proposed transition.
 * Returns { ok, code, message, missing } — never throws, because this runs on every
 * keystroke in the stage-change modal.
 */
export function validateTransition(lead, toStage, { role } = {}) {
  const from = lead?.stage

  if (!isValidStage(from)) {
    return { ok: false, code: 'INVALID_CURRENT', message: `Unknown current stage: ${from}`, missing: [] }
  }
  if (!isValidStage(toStage)) {
    return { ok: false, code: 'INVALID_TARGET', message: `Unknown target stage: ${toStage}`, missing: [] }
  }
  if (from === toStage) {
    return { ok: true, code: 'NOOP', message: '', missing: [] }
  }
  /**
   * Reopening — the one move that is still gated, and by ROLE rather than by route.
   *
   * An accidental `lost` is exactly the mistake this whole change exists to make fixable,
   * so it must be possible. But leaving a closed stage un-counts a win or a loss, which
   * moves the revenue and CAC figures §8 publishes and someone may already have acted on.
   * That is a decision for whoever answers for those numbers, not for whoever happened to
   * mis-tap. An agent asks; a manager does it.
   */
  if (isTerminal(from) && !REOPEN_ROLES.includes(role)) {
    return {
      ok: false,
      code: 'REOPEN_FORBIDDEN',
      message: `This lead is ${from}. Ask a manager to reopen it.`,
      missing: [],
    }
  }
  if (!canTransition(from, toStage)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      message: `Cannot move from ${from} to ${toStage}.`,
      missing: [],
    }
  }

  const required = STAGE_REQUIREMENTS[toStage] ?? []
  const missing = required.filter((path) => !isPresent(readPath(lead, path)))

  if (missing.length) {
    return {
      ok: false,
      code: 'MISSING_FIELDS',
      message: `Fill in ${missing.join(', ')} before moving to ${toStage}.`,
      missing,
    }
  }

  // A won deal must actually be worth something (§5.2).
  if (toStage === 'won' && !(Number.isInteger(lead.dealValueMinor) && lead.dealValueMinor > 0)) {
    return {
      ok: false,
      code: 'INVALID_DEAL_VALUE',
      message: 'A won lead needs a deal value greater than zero.',
      missing: ['dealValueMinor'],
    }
  }

  return { ok: true, code: 'OK', message: '', missing: [] }
}

/* ---------------------------------------------------------------------------
 * Presentation
 * ------------------------------------------------------------------------- */

/** i18n keys, resolved through vue-i18n. Never hard-code English in a component. */
export function stageLabelKey(stage) {
  return `stage.${stage}`
}

/**
 * Tailwind classes per stage. `unreachable` is deliberately amber and `parked` grey:
 * an agent scanning a list must see at a glance which leads are chaseable.
 */
export const STAGE_STYLES = Object.freeze({
  new: 'bg-slate-100 text-slate-700 ring-slate-200',
  contacted: 'bg-sky-100 text-sky-800 ring-sky-200',
  unreachable: 'bg-amber-100 text-amber-800 ring-amber-200',
  qualified: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  quoted: 'bg-violet-100 text-violet-800 ring-violet-200',
  negotiation: 'bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200',
  won: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  lost: 'bg-rose-100 text-rose-800 ring-rose-200',
  parked: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
  nurture: 'bg-teal-100 text-teal-800 ring-teal-200',
  disqualified: 'bg-neutral-200 text-neutral-500 ring-neutral-300',
})

/**
 * Left-to-right order for the kanban board. Terminal stages sit at the end.
 *
 * MUST list EVERY stage in `STAGES`. The board groups leads with
 * `filter(l => l.stage === column)`, so a stage missing from here has no column and its
 * leads are not rendered anywhere at all - they do not fall into an "other" bucket, they
 * silently vanish. That is exactly what happened when `nurture`, `parked` and
 * `disqualified` were added to TRANSITIONS but not to this list: the move dialog offered
 * destinations the board could not display. `stages.test.js` now asserts the invariant.
 *
 * LeadListView derives its filter chips from this array too, so an omission there also
 * removes the only way to filter back to the lost stage.
 */
export const BOARD_ORDER = Object.freeze([
  'new',
  'contacted',
  // The three holding states sit next to `unreachable` because that is where they come
  // from in practice: you could not reach them, so you park them, or you keep them warm.
  'unreachable',
  'parked',
  'nurture',
  'qualified',
  'quoted',
  'negotiation',
  'won',
  'lost',
  'disqualified',
])

export const LOSS_REASONS = Object.freeze([
  'price',
  'chose_competitor',
  'did_it_themselves',
  'event_cancelled',
  'no_budget',
  'no_response',
  'wrong_fit',
  'other',
])

export const PARK_REASONS = Object.freeze([
  'no_response_after_cadence',
  'event_date_passed',
  'postponed',
  'waiting_on_committee',
])
