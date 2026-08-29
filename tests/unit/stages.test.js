import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import {
  STAGES,
  STAGE_LIST,
  TRANSITIONS,
  TERMINAL_STAGES,
  OPEN_STAGES,
  BOARD_ORDER,
  STAGE_STYLES,
  STAGE_WIN_PROBABILITY,
  LOSS_REASONS,
  PARK_REASONS,
  leadStatusFor,
  isValidStage,
  isTerminal,
  isOpen,
  nextStages,
  canTransition,
  validateTransition,
} from '../../src/domain/stages.js'

const qualifiedLead = {
  stage: 'qualified',
  eventDate: new Date('2026-12-14'),
  dealValueMinor: 15000000,
  qualification: { budgetBand: '150-500k', decisionMakerContactId: 'c1' },
}

describe('stage constants', () => {
  it('exposes every stage in TRANSITIONS and vice versa', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STAGE_LIST].sort())
  })

  it('only ever points at real stages', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        expect(STAGE_LIST, `${from} → ${to} is not a real stage`).toContain(to)
      }
    }
  })

  it('includes each stage as a self-transition, so unrelated field edits are not blocked', () => {
    for (const stage of STAGE_LIST) {
      expect(TRANSITIONS[stage], `${stage} must allow itself`).toContain(stage)
    }
  })

  it('gives every stage a style and a win probability', () => {
    for (const stage of STAGE_LIST) {
      expect(STAGE_STYLES[stage], `no style for ${stage}`).toBeTypeOf('string')
      expect(STAGE_WIN_PROBABILITY[stage], `no probability for ${stage}`).toBeTypeOf('number')
    }
  })

  it('keeps win probabilities inside 0..1', () => {
    for (const p of Object.values(STAGE_WIN_PROBABILITY)) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('treats open and terminal as disjoint', () => {
    for (const stage of OPEN_STAGES) {
      expect(TERMINAL_STAGES).not.toContain(stage)
    }
  })

  it('only boards real stages', () => {
    for (const stage of BOARD_ORDER) expect(STAGE_LIST).toContain(stage)
  })
})

describe('closed stages are reopenable, but only by a manager', () => {
  // These stages used to be dead ends for everyone. They are not any more: an accidental
  // "lost" was unfixable, and the only remedy on offer was to abandon the lead's timeline
  // and re-key it. What guards them now is a ROLE, because leaving a closed stage
  // un-counts a win or a loss and moves figures 8 has already published.
  it('offers a way out, so an accidental close is correctable', () => {
    for (const stage of TERMINAL_STAGES) {
      expect(nextStages(stage), `${stage} should be escapable`).not.toEqual([])
    }
  })

  it('refuses an agent reopening a won lead', () => {
    const r = validateTransition({ stage: 'won' }, 'negotiation', { role: 'agent' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('REOPEN_FORBIDDEN')
    expect(r.message, 'must say who CAN do it').toMatch(/manager/i)
  })

  it('refuses when no role is supplied at all — closed by default', () => {
    expect(validateTransition({ stage: 'lost' }, 'contacted').code).toBe('REOPEN_FORBIDDEN')
  })

  it('lets a manager and an admin reopen', () => {
    for (const role of ['manager', 'admin']) {
      const r = validateTransition({ stage: 'lost' }, 'contacted', { role })
      expect(r.ok, `${role} should be able to reopen`).toBe(true)
    }
  })

  it('still demands the entry requirements of wherever it is reopened INTO', () => {
    // Reopening is not a bypass: moving a lost lead straight to `qualified` still needs
    // BEDS, exactly as it would from any other stage.
    const r = validateTransition({ stage: 'lost' }, 'qualified', { role: 'admin' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('MISSING_FIELDS')
  })
})

describe('leadStatusFor', () => {
  it('projects each stage onto the queryable status', () => {
    expect(leadStatusFor('won')).toBe('closed_won')
    expect(leadStatusFor('lost')).toBe('closed_lost')
    expect(leadStatusFor('disqualified')).toBe('closed_lost')
    expect(leadStatusFor('parked')).toBe('parked')
    expect(leadStatusFor('new')).toBe('open')
    expect(leadStatusFor('negotiation')).toBe('open')
  })

  it('maps every open stage to "open"', () => {
    for (const stage of OPEN_STAGES) expect(leadStatusFor(stage)).toBe('open')
  })
})

describe('predicates', () => {
  it('validates stage names', () => {
    expect(isValidStage('new')).toBe(true)
    expect(isValidStage('NEW')).toBe(false)
    expect(isValidStage('')).toBe(false)
    expect(isValidStage(null)).toBe(false)
    expect(isValidStage(undefined)).toBe(false)
    expect(isValidStage(123)).toBe(false)
  })

  it('classifies terminal and open', () => {
    expect(isTerminal('won')).toBe(true)
    expect(isTerminal('parked')).toBe(false)
    expect(isOpen('quoted')).toBe(true)
    expect(isOpen('parked')).toBe(false)
  })
})

describe('canTransition', () => {
  it('permits the documented moves', () => {
    expect(canTransition('new', 'contacted')).toBe(true)
    expect(canTransition('unreachable', 'parked')).toBe(true)
    expect(canTransition('quoted', 'won')).toBe(true)
    expect(canTransition('parked', 'contacted')).toBe(true)
  })

  it('permits moving BACKWARDS — the correction the funnel used to forbid', () => {
    // The reported bug, in one line: a lead tapped into `contacted` by mistake could not
    // be put back. The stage records where a deal is, not the route it took; the route is
    // in the timeline, where a correction cannot erase it.
    expect(canTransition('contacted', 'new')).toBe(true)
    expect(canTransition('quoted', 'contacted')).toBe(true)
    expect(canTransition('negotiation', 'qualified')).toBe(true)
  })

  it('permits skipping ahead — the DATA requirements are what gate a jump', () => {
    // canTransition only answers "is this route allowed". Whether a lead may actually
    // BECOME won is validateTransition's business, and it still refuses without a deal
    // value — see the requirement suites below.
    expect(canTransition('new', 'won')).toBe(true)
    expect(canTransition('new', 'quoted')).toBe(true)
    expect(validateTransition({ stage: 'new' }, 'won', { role: 'admin' }).ok).toBe(false)
  })

  it('permits leaving a closed stage, with the role check applied separately', () => {
    expect(canTransition('won', 'lost')).toBe(true)
    expect(canTransition('lost', 'contacted')).toBe(true)
    expect(canTransition('disqualified', 'new')).toBe(true)
  })

  it('is false for garbage rather than throwing', () => {
    expect(canTransition(null, 'won')).toBe(false)
    expect(canTransition('new', undefined)).toBe(false)
    expect(canTransition('nope', 'nope')).toBe(false)
  })
})

describe('validateTransition — BEDS gating, §5.3', () => {
  it('blocks qualification without budget, event date or decision maker', () => {
    const bare = { stage: 'contacted', qualification: {} }
    const r = validateTransition(bare, 'qualified')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('MISSING_FIELDS')
    expect(r.missing).toContain('eventDate')
    expect(r.missing).toContain('qualification.budgetBand')
    expect(r.missing).toContain('qualification.decisionMakerContactId')
  })

  it('treats budgetBand "unknown" as absent, not as an answer', () => {
    const lead = {
      stage: 'contacted',
      eventDate: new Date('2026-12-14'),
      qualification: { budgetBand: 'unknown', decisionMakerContactId: 'c1' },
    }
    expect(validateTransition(lead, 'qualified').missing).toContain('qualification.budgetBand')
  })

  it('allows qualification once BEDS is satisfied', () => {
    const lead = {
      stage: 'contacted',
      eventDate: new Date('2026-12-14'),
      qualification: { budgetBand: '150-500k', decisionMakerContactId: 'c1' },
    }
    expect(validateTransition(lead, 'qualified')).toMatchObject({ ok: true, code: 'OK' })
  })

  it('requires a loss reason before losing', () => {
    const r = validateTransition({ ...qualifiedLead }, 'lost')
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('lossReason')
  })

  it('does NOT demand the server-stamped closure fields', () => {
    // Regression. Requiring closedAt/closedBy here made winning or losing a deal
    // impossible: changeStage() validates BEFORE it stamps them, so every close failed
    // with "Fill in closedAt, closedBy". The core path of the product, unreachable.
    // The server enforces those fields via closureFieldsPresent() in firestore.rules.
    const lost = validateTransition({ ...qualifiedLead, lossReason: 'price' }, 'lost')
    expect(lost.ok, lost.message).toBe(true)

    const won = validateTransition({ stage: 'quoted', dealValueMinor: 15000000 }, 'won')
    expect(won.ok, won.message).toBe(true)
  })

  it('accepts a loss that arrives already stamped', () => {
    const lead = { ...qualifiedLead, lossReason: 'price', closedAt: new Date(), closedBy: 'u1' }
    expect(validateTransition(lead, 'lost').ok).toBe(true)
  })

  it('refuses a won deal worth zero', () => {
    const lead = {
      stage: 'quoted',
      dealValueMinor: 0,
      closedAt: new Date(),
      closedBy: 'u1',
    }
    const r = validateTransition(lead, 'won')
    expect(r.ok).toBe(false)
    // dealValueMinor: 0 is "present" but not valid — the code must say which.
    expect(['MISSING_FIELDS', 'INVALID_DEAL_VALUE']).toContain(r.code)
  })

  it('refuses a won deal with a non-integer value', () => {
    const lead = {
      stage: 'quoted',
      dealValueMinor: 150000.5,
      closedAt: new Date(),
      closedBy: 'u1',
    }
    expect(validateTransition(lead, 'won').code).toBe('INVALID_DEAL_VALUE')
  })

  it('accepts a fully-formed win', () => {
    const lead = {
      stage: 'quoted',
      dealValueMinor: 15000000,
      closedAt: new Date(),
      closedBy: 'u1',
    }
    expect(validateTransition(lead, 'won').ok).toBe(true)
  })

  it('requires a park reason', () => {
    const r = validateTransition({ stage: 'unreachable' }, 'parked')
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('parkReason')
  })

  it('treats a same-stage move as a no-op rather than an error', () => {
    expect(validateTransition({ stage: 'new' }, 'new')).toMatchObject({ ok: true, code: 'NOOP' })
  })

  it('never throws on malformed input', () => {
    expect(() => validateTransition(null, 'won')).not.toThrow()
    expect(() => validateTransition(undefined, undefined)).not.toThrow()
    expect(() => validateTransition({}, 'won')).not.toThrow()
    expect(validateTransition(null, 'won').ok).toBe(false)
  })

  it('reports a bad stage NAME distinctly from missing fields', () => {
    // ILLEGAL_TRANSITION is no longer reachable from a real stage pair now that the graph
    // is complete, but the codes stay distinct: a typo is not a missing field.
    expect(validateTransition({ stage: 'new' }, 'nope').code).toBe('INVALID_TARGET')
    expect(validateTransition({ stage: 'new' }, 'won').code).toBe('MISSING_FIELDS')
  })
})

describe('taxonomies', () => {
  it('offers the documented loss and park reasons', () => {
    expect(LOSS_REASONS).toContain('no_response')
    expect(LOSS_REASONS).toContain('did_it_themselves')
    expect(PARK_REASONS).toContain('no_response_after_cadence')
  })

  it('keeps them unique', () => {
    expect(new Set(LOSS_REASONS).size).toBe(LOSS_REASONS.length)
    expect(new Set(PARK_REASONS).size).toBe(PARK_REASONS.length)
  })
})

// ---------------------------------------------------------------------------
// The drift guard. If this fails, the client and the server disagree about what
// moves are legal — which means either the UI offers a button the server rejects,
// or the server accepts a move the UI believed impossible. Both are serious.
// ---------------------------------------------------------------------------
describe('firestore.rules agrees with stages.js', () => {
  const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url))
  const rules = readFileSync(rulesPath, 'utf8')

  /**
   * Strip `//` comments before parsing.
   *
   * Without this the guard had a blind spot: commenting out a map entry
   * (`// 'parked': [...]`) still looked present to the regex, while Firestore's
   * `.get(from, [])` silently denied every exit from that stage. Mutation-tested.
   */
  const rulesWithoutComments = rules
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

  function transitionsFromRules() {
    const block = rulesWithoutComments.match(
      /function allowedNextStages\(from\)\s*\{[\s\S]*?\}\.get\(from, \[\]\);/,
    )
    if (!block) throw new Error('allowedNextStages() not found in firestore.rules')

    const map = {}
    const entry = /'([a-z_]+)':\s*\[([^\]]*)\]/g
    let m
    while ((m = entry.exec(block[0])) !== null) {
      map[m[1]] = m[2]
        .split(',')
        .map((s) => s.trim().replace(/'/g, ''))
        .filter(Boolean)
    }
    return map
  }

  it('defines the same stages on both sides', () => {
    expect(Object.keys(transitionsFromRules()).sort()).toEqual(Object.keys(TRANSITIONS).sort())
  })

  it('defines the same transitions for every stage', () => {
    const fromRules = transitionsFromRules()
    for (const stage of Object.keys(TRANSITIONS)) {
      expect([...fromRules[stage]].sort(), `mismatch on stage "${stage}"`).toEqual(
        [...TRANSITIONS[stage]].sort(),
      )
    }
  })

  it('still actually USES the map to gate transitions', () => {
    // Second blind spot found by mutation testing: gutting stageTransitionValid() to
    // `return true` left the map intact, so the suite stayed green while the server
    // enforced nothing at all. Matching the map is necessary, not sufficient.
    const guard = rulesWithoutComments.match(
      /function stageTransitionValid\(\)\s*\{[\s\S]*?\}/,
    )
    expect(guard, 'stageTransitionValid() not found in firestore.rules').not.toBeNull()
    expect(guard[0]).toContain('allowedNextStages(existing().stage)')
    expect(guard[0]).toContain('incoming().stage in')
  })

  it('enforces the §5.2 closure invariants server-side', () => {
    // The client cannot be the only thing stopping a deal being won at zero, or lost with
    // an empty reason — TODO.md P10.
    const closure = rulesWithoutComments.match(
      /function closureFieldsPresent\(\)\s*\{[\s\S]*?\n    \}/,
    )
    expect(closure, 'closureFieldsPresent() not found').not.toBeNull()
    expect(closure[0]).toContain('dealValueMinor > 0')
    expect(closure[0]).toContain('lossReason.size() > 0')
  })
})

describe('STAGES enum', () => {
  it('maps each constant to its own string value', () => {
    expect(STAGES.NEW).toBe('new')
    expect(STAGES.DISQUALIFIED).toBe('disqualified')
    expect(Object.values(STAGES)).toEqual(STAGE_LIST)
  })
})

/**
 * The board is the only place a lead is grouped by `filter(l => l.stage === column)`, which
 * means a stage with no column renders nowhere — the lead is not "elsewhere", it is gone
 * from the screen. This suite exists because `nurture`, `parked` and `disqualified` were
 * added to TRANSITIONS without being added to BOARD_ORDER, so the move dialog offered
 * destinations that made the card disappear.
 */
describe('BOARD_ORDER can render every stage a lead can reach', () => {
  it('has a column for every stage in STAGES', () => {
    const missing = STAGE_LIST.filter((stage) => !BOARD_ORDER.includes(stage))
    expect(missing, `stages with no board column: ${missing.join(', ')}`).toEqual([])
  })

  it('has a column for every destination the move dialog can offer', () => {
    // What the UI actually puts in front of the user is nextStages(), i.e. TRANSITIONS.
    const offered = [...new Set(Object.values(TRANSITIONS).flat())]
    const undisplayable = offered.filter((stage) => !BOARD_ORDER.includes(stage))
    expect(
      undisplayable,
      `move dialog can send a lead to a stage with no column: ${undisplayable.join(', ')}`,
    ).toEqual([])
  })

  it('has a column for every stage a lead can be in, from either side of the machine', () => {
    // Belt and braces: sources as well as destinations.
    const reachable = [...new Set([...Object.keys(TRANSITIONS), ...Object.values(TRANSITIONS).flat()])]
    for (const stage of reachable) {
      expect(BOARD_ORDER, `${stage} is reachable but has no column`).toContain(stage)
    }
  })

  it('lists no stage twice and invents none', () => {
    expect(new Set(BOARD_ORDER).size, 'duplicate column').toBe(BOARD_ORDER.length)
    for (const stage of BOARD_ORDER) expect(isValidStage(stage), `${stage} is not a stage`).toBe(true)
  })

  it('can style and therefore render every column', () => {
    // A column with no style entry renders unreadable, which is its own kind of invisible.
    for (const stage of BOARD_ORDER) {
      expect(STAGE_STYLES[stage], `${stage} has no STAGE_STYLES entry`).toBeTruthy()
    }
  })

  it('keeps the terminal stages at the end', () => {
    const firstTerminal = BOARD_ORDER.findIndex((s) => TERMINAL_STAGES.includes(s))
    const lastOpen = BOARD_ORDER.reduce((acc, s, i) => (OPEN_STAGES.includes(s) ? i : acc), -1)
    expect(firstTerminal, 'an open stage sits after a terminal one').toBeGreaterThan(lastOpen)
  })
})
