# Haflaway CRM — Master Implementation Plan

> **Read this first.** This is the single source of truth for *what* we are building, *why* each
> decision was made, and *in what order* work happens. Any agent (human or AI) should be able to
> open this file, pick the first unchecked box in the current phase, and start working without
> asking questions.

| | |
|---|---|
| **Product** | Haflaway CRM — lead-to-cash system for a digital invitations & event-services business |
| **Company** | Haflaway (eCards, digital invitations, event reminders, RSVP, related services) |
| **Scale target** | ~50 sales/field staff, single organisation, multiple teams |
| **Stack** | Vue 3 + Vite (existing scaffold) · Firebase Auth · Cloud Firestore · Cloud Storage |
| **Status** | Phases 0–2 complete · Phase 3 (pipeline, stages) and a first-cut Phase 6 (CAC dashboard) working · Phase 4 cadence engine next |
| **Last updated** | 2026-08-24 |
| **Tests** | 270 unit · 36 view-mount · 122 security-rules · 42 integration (live emulator) — all green · bundle 117.3 KB, asserted on the built output · `npm run smoke` |

---

## 0. How to use this document

- Work **top-to-bottom by phase**. Phases are ordered by dependency, not by excitement.
- `- [ ]` = not started · `- [x]` = done · `- [~]` = in progress (add initials: `- [~] @sam`)
- **Never skip §1–§9.** They are the contract. §10 onward is the build queue.
- If you disagree with a decision in §2 or §8, **do not silently change it** — add it to §17
  (Open Decisions) and raise it. Half the metrics in this system become wrong the moment two
  people define "closed" differently.
- Any task that changes data shape must also update §6 (Data Model) in the same commit.

---

## 1. Executive summary

Haflaway sells digital invitations and event services. Demand arrives from Facebook, Instagram,
WhatsApp, referrals, and physical visits to **committees** — the organising groups behind weddings,
send-offs, kitchen parties, graduations and fundraisers. Roughly 50 staff each work their own
pipeline. Money goes out on ads and on staff; management currently cannot see what that money buys.

The system must do four things, in this order of importance:

1. **Capture every lead** the moment it touches the company, from any channel, in under 20 seconds.
2. **Make the follow-up impossible to forget** — the "I'll call them later" gap is where the
   revenue dies, especially with unreachable prospects.
3. **Record what money went in** — ad spend per campaign, cost per staff member — against a ledger
   that cannot be quietly edited.
4. **Divide (3) by (1)** honestly, and show it weekly and monthly: blended, per campaign, per staff.

Everything else — dashboards, exports, automations — is decoration on those four.

---

## 2. Philosophy — the twelve principles

These are the reasons behind the technical choices. Read them before arguing with the schema.

### P1 — A lead is a *story*, not a row
The current state of a lead (`stage: "qualified"`) is a lossy summary. The truth is the sequence of
things that happened: called, no answer, called again, spoke to the groom's sister, she said the
committee meets Sunday, sent a quote, they went quiet. **The timeline is the primary record; the
lead document is a cached projection of it.** This is why `activities` is append-only and why we
never delete an activity — we mark it voided.

### P2 — The event date is the real clock
Generic CRMs sort by "last contacted". Haflaway's leads carry a **hard, externally-imposed
deadline**: the wedding happens on the 14th whether we closed or not. A lead with an event in 18
days is categorically hotter than one with an event in 8 months, regardless of how enthusiastic
they sound. Urgency is computed from `eventDate`, not from vibes. This single idea is our biggest
edge over bolting the business onto a generic CRM.

### P3 — The buyer is a committee, not a person
One lead can have five decision-makers: bride, groom, chairperson, treasurer, and the aunt who
actually pays. Modelling one phone number per lead loses the deal. Leads own a set of **contacts
with roles**, and we track who is the *economic buyer* separately from who is the *day-to-day
contact*.

### P4 — Money facts are immutable
Ad spend, expense entries, deal values and stage transitions are **appended, never mutated**. A
correction is a new entry that references the one it corrects. Reason: the moment CAC-per-staff
influences anyone's pay, the numbers become politically contested. The ledger must survive an
argument. Dashboards are recomputable; history is not.

### P5 — Attribution is a *policy*, not a fact
No system can truthfully say which ad caused a wedding booking. We therefore (a) freeze an
`attribution` object on the lead at creation, (b) default to **first-touch**, (c) store enough raw
touch data to recompute under last-touch or linear later, and (d) **print the model name on every
chart that uses it**. A CAC number without a stated attribution model is a lie with a decimal point.

### P6 — Cohorts, not calendar buckets
"August CAC" is ambiguous: leads created in August, or customers won in August? Those give wildly
different answers when the sales cycle runs 3–10 weeks. **Default to cohort view** — spend and
outcomes follow the lead's creation month — and offer period view as an explicit toggle. See §8.8.

### P7 — Faster than a notebook, or it will not be used
Field staff at a committee meeting have one hand, patchy 4G, and 90 seconds. If logging a call
takes more taps than writing it in a notebook, adoption fails and every downstream metric is
garbage. **Hard budget: new lead in ≤20s, log an interaction in ≤3 taps, works fully offline.**
Enforce this in review — reject any flow that breaks it.

### P8 — Offline is the normal case, not the edge case
Firestore's local cache is the app's database; the network is a sync detail. Every write is
optimistic. The UI must never show a spinner waiting for the server to accept a note.

### P9 — Firestore has no GROUP BY — design for it up front
Analytics cannot be bolted onto a normalised schema afterwards. We **pre-aggregate on write** into
rollup documents so a dashboard costs about 5 reads instead of 40,000. Denormalisation is not a
smell here; it is the architecture.

### P10 — Security rules are the domain model
With 50 users and commission at stake, "the UI hides that button" is not access control. Rules are
written first, tested against the emulator, and treated as production code. An agent must not be
able to read a colleague's pipeline or edit a cost figure.

### P11 — Every number drills down to documents
Any figure on any dashboard must be clickable down to the exact leads or expenses that produced it.
A metric nobody can audit is a metric nobody trusts, and untrusted metrics get overridden by
whoever speaks loudest in the meeting.

### P12 — Build the Haflaway funnel, not a generic CRM
Resist "let's make stages configurable per user", "let's add a workflow builder", "let's support
any industry". We are building one company's machine. Configurability is a Phase-11 luxury and each
knob doubles the test surface.

---

## 3. Competitive research — what we steal, what we refuse

Findings from established lead-management systems, mapped onto our decisions.

| Product | Idea worth stealing | Our take |
|---|---|---|
| **Pipedrive** | Activity-centric pipeline: a deal with no *scheduled next action* is visually flagged as rotting. | **Steal wholesale.** `nextActionAt` is required on every open lead. No next action = red row. Best single UX idea in the category. |
| **HubSpot** | Lifecycle stage kept separate from deal stage; source attribution baked into the record at creation. | Steal the split (`leadStatus` vs `stage`) and frozen attribution. Refuse the sprawling object model. |
| **Salesforce** | Lead → Convert → (Account, Contact, Opportunity). Assignment rules. Field-level audit history. | Steal conversion semantics and the audit trail. Refuse the complexity: we convert Lead → Customer + Project. |
| **Close.com** | Built for high-volume calling: call outcomes are first-class data, plus first-response SLA tracking. | Steal the **call outcome taxonomy** (`spoke`, `no_answer`, `busy`, `switched_off`, `wrong_number`, `callback_requested`). Directly serves the unreachable-lead problem. |
| **Zoho CRM** | Scoring rules; "blueprint" — enforced, validated stage transitions. | Steal enforced transitions (state machine, §5.2). Defer the rules engine; ship a fixed formula first. |
| **Outreach / SalesLoft** | **Cadences**: a lead enters a named sequence and the system schedules each touch. | Steal as our **Follow-up Cadence Engine** (§10). This is the heart of the "set periods to check them out" requirement. |
| **Twenty / EspoCRM (open source)** | Clean lead/opportunity separation; timeline modelled as an event log. | Confirms P1. Reviewed for schema shape. |
| **Odoo CRM** | Expenses tagged to analytic accounts, making cost-per-anything queryable. | Steal the **allocation dimension**: every expense carries `allocation` (campaign / staff / team / overhead). This is the thing that makes CAC-per-staff possible at all. |
| **Attio** | Records stay flexible while reporting stays fast, because storage is columnar underneath. | A reminder that Firestore is not that. Reinforces P9. |

**What all of them get wrong for us:** none model an *externally fixed delivery deadline* (P2) or a
*committee* buyer (P3). Those two are why we build rather than buy.

**Honest note.** For ~50 users, an off-the-shelf CRM plus a spreadsheet would work at a fraction of
the effort. We are building because of P2, P3, the Swahili-first field UX, and because CAC-per-staff
needs cost data that hosted CRMs make expensive to model. Keep that justification true — if the
build drifts into rebuilding generic HubSpot, stop and reconsider.

---

## 4. Ubiquitous language (glossary)

Use these words in code, in the UI, and in conversation. Do not invent synonyms.

| Term | Meaning |
|---|---|
| **Lead** | A potential piece of business, created the moment someone shows interest. Owns contacts, activities, and one prospective event. |
| **Contact** | A human attached to a lead. Has a `role` (bride, groom, chairperson, treasurer, planner, other) and flags `isPrimary`, `isDecisionMaker`. |
| **Committee** | The organising group behind an event: the set of contacts on a lead, plus `committeeMeetsOn`. |
| **Event** | The real-world occasion (harusi, send-off, kitchen party, graduation, corporate). Has `eventDate`, `eventType`, `guestCountEstimate`. |
| **Stage** | Position in the sales pipeline. See §5.2. |
| **Activity** | An immutable timeline entry: `call`, `whatsapp`, `visit`, `note`, `quote_sent`, `stage_change`, `assignment`, `payment`, `system`. |
| **Task** | A scheduled future action with a `dueAt`. Created manually or by a cadence. |
| **Cadence** | A named schedule of follow-up attempts (§10). |
| **Campaign** | A named marketing effort with a budget and spend entries. Has a `channel`. |
| **Expense** | Any money out. Always carries an `allocation`. |
| **Won** | Deposit received **and** delivery scope agreed. Not "they said yes". |
| **Lost** | Explicitly closed with a `lossReason`. Distinct from Parked. |
| **Parked** | Went silent after cadence exhaustion, or the event date passed with no decision. Recyclable. |
| **Customer** | Created on the first Won lead. Carries lifetime value across repeat events. |
| **Project** | The delivery job created on Won. Tracks design, approval, dispatch. |
| **CAC** | Customer Acquisition Cost. Precisely defined in §8.5 — never use the term loosely. |

**Swahili UI mapping** (see §13): Lead → *Mteja tarajiwa* · Follow-up → *Kufuatilia* ·
Won → *Imefanikiwa* · Lost → *Imepotea* · Committee → *Kamati* · Event → *Tukio*.

---

## 5. Domain design

### 5.1 Object flow

```
                  ┌──────────────┐
   Ad / DM /      │              │  qualify        ┌──────────┐   win    ┌──────────┐
   Visit /   ───► │    LEAD      │ ──────────────► │  QUOTED  │ ───────► │ CUSTOMER │
   Referral       │ (+contacts)  │                 │          │          │ +PROJECT │
                  └──────┬───────┘                 └────┬─────┘          └────┬─────┘
                         │                              │                     │
                         │ every touch                  │ lose / park         │ repeat event
                         ▼                              ▼                     ▼
                  ┌──────────────┐              ┌──────────────┐       ┌──────────────┐
                  │  ACTIVITIES  │              │ LOSS REASON  │       │   NEW LEAD   │
                  │(append-only) │              │  (required)  │       │source=repeat │
                  └──────────────┘              └──────────────┘       └──────────────┘
```

### 5.2 Pipeline state machine

Transitions are enforced by a shared `canTransition()` helper **and** by security rules. Illegal
jumps are rejected, not merely hidden in the UI.

| Stage | Meaning | Allowed exits |
|---|---|---|
| `new` | Captured; nobody has spoken to them yet | `contacted`, `unreachable`, `disqualified` |
| `contacted` | A two-way conversation happened | `qualified`, `nurture`, `unreachable`, `lost` |
| `unreachable` | Attempts made, no contact yet. **In an active cadence.** | `contacted`, `parked` (cadence exhausted) |
| `qualified` | Event date, type, budget band and decision path known | `quoted`, `nurture`, `lost` |
| `quoted` | Price presented | `negotiation`, `won`, `lost` |
| `negotiation` | Terms or price under discussion | `won`, `lost` |
| `won` | Deposit received AND scope agreed | terminal → creates Customer + Project |
| `lost` | Explicit no. `lossReason` **required** | terminal (re-openable as a new lead) |
| `parked` | Went silent, or event passed. `parkReason` required | → recycled into a nurture cadence |
| `nurture` | Real prospect, event far out (>90 days) | `contacted` when the clock closes in |
| `disqualified` | Not a real prospect (spam, wrong number, out of area) | terminal |

**Invariants.** `won` and `lost` require `closedAt` and `closedBy`. `won` requires
`dealValueMinor > 0` and at least one `payment` activity. Every stage change writes a
`stage_change` activity — no exceptions.

### 5.3 Qualification framework — BEDS

BANT adapted to the event business. Stored as a small object on the lead.

- **B — Budget**: `budgetBand` — `unknown` | `<50k` | `50-150k` | `150-500k` | `500k+` (TZS)
- **E — Event**: `eventDate`, `eventType`, `guestCountEstimate` *(the strongest predictor of value)*
- **D — Decision**: who signs off — `decisionMakerContactId` set, `committeeMeetsOn` known
- **S — Scope**: which services they want — `interestedProductIds[]`

A lead may only enter `qualified` when B, E and D are non-null. Enforced in the transition helper.
`qualificationScore` is a fixed weighted sum (§8.7), recomputed on write. **Fixed formula in v1 —
no rules engine** (P12).

---

## 6. Firestore data model

### 6.1 Conventions

- **Flat top-level collections**; every document carries `orgId` (one org today, cheap
  multi-tenancy tomorrow). Subcollections only for strictly-owned, high-cardinality children.
- **IDs**: Firestore auto-IDs, except deterministic index docs (see `leadPhoneIndex`).
- **Money**: integer **minor units** (`amountMinor`) plus `currency` (`"TZS"`). Never floats, never
  formatted strings in storage.
- **Timestamps**: Firestore `Timestamp`. Business periods are computed in
  **`Africa/Dar_es_Salaam`** and *additionally* denormalised as strings — `dayKey: "2026-08-24"`,
  `weekKey: "2026-W35"`, `monthKey: "2026-08"` — so rollups and range queries stay trivial.
- **Every doc** carries `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `orgId`.
- **Soft delete only**: `deletedAt`, `deletedBy`. Nothing is hard-deleted except at retention expiry.

### 6.2 Collections

```
users/{uid}
  displayName, email, phone, photoPath
  role: 'admin'|'manager'|'finance'|'agent'|'viewer'
  teamId, isActive, locale: 'sw'|'en'
  targets: { monthlyLeads, monthlyRevenueMinor }
  capacity: { maxOpenLeads }             // round-robin fairness
  lastActiveAt, fcmTokens[]

teams/{teamId}
  name, managerId, memberIds[], region

leads/{leadId}
  orgId, ownerId, previousOwnerIds[], teamId
  # identity
  displayName                            // "Neema & Baraka — Harusi 14 Dec"
  primaryPhone, primaryPhoneNormalized   // E.164, +255...
  altPhones[], email
  # event  (P2)
  eventType, eventDate, eventDateIsFirm, guestCountEstimate, venueArea, region
  daysToEvent                            // denormalised, refreshed nightly
  # pipeline
  stage, stageEnteredAt, previousStage
  leadStatus                             // 'open'|'closed_won'|'closed_lost'|'parked'
  qualification: { budgetBand, decisionMakerContactId, committeeMeetsOn, interestedProductIds[] }
  qualificationScore, urgencyScore, priorityScore
  # money
  dealValueMinor, currency, depositPaidMinor, marginEstimateMinor
  # follow-up  (§10)
  nextActionAt, nextActionType, firstContactedAt, lastContactedAt, lastActivityAt
  contactAttempts, consecutiveNoAnswer
  cadence: { id, step, enteredAt, exhaustedAt }
  isStale                                // computed: nextActionAt < now
  # attribution  (P5) — FROZEN at create
  attribution: {
    model: 'first_touch', source, channel, campaignId, adsetId, adId,
    utm: { source, medium, campaign, content, term },
    referrerCustomerId, capturedByUserId, capturedAt
  }
  touchpoints[]                          // capped array {channel, campaignId, at} for re-modelling
  # consent (§7.3)
  marketingConsent, consentCapturedAt, consentSource
  # outcome
  closedAt, closedBy, lossReason, lossNotes, parkReason
  customerId, projectId                  // set on win
  # bookkeeping
  dayKey, weekKey, monthKey              // of createdAt
  tags[], createdAt, createdBy, updatedAt, updatedBy, deletedAt

leads/{leadId}/contacts/{contactId}
  name, phone, phoneNormalized, email, role, isPrimary, isDecisionMaker, notes

leads/{leadId}/activities/{activityId}         # APPEND-ONLY (P1, P4)
  type, at, byUserId, byUserName
  channel        // 'call'|'whatsapp'|'sms'|'in_person'|'facebook'|'instagram'|'email'
  outcome        // 'spoke'|'no_answer'|'busy'|'switched_off'|'wrong_number'|'callback_requested'
  durationSec, body, attachmentPaths[]
  meta                                   // type-specific payload (from/to stage, amount, ...)
  isVoided, voidedBy, voidReason         // corrections never delete

leads/{leadId}/quotes/{quoteId}
  lineItems[{ productId, name, qty, unitPriceMinor }]
  subtotalMinor, discountMinor, totalMinor, currency
  validUntil, status: 'draft'|'sent'|'accepted'|'rejected'|'expired'
  pdfPath, sentAt, sentVia

leadPhoneIndex/{phoneNormalized}         # DEDUPE LOCK (§6.4)
  leadId, ownerId, createdAt

tasks/{taskId}                           # top-level: "my follow-ups today" is one query
  orgId, leadId, leadName, leadPhone     // denormalised for list rendering
  ownerId, teamId
  title, type, dueAt, dayKey
  status: 'open'|'done'|'skipped'|'cancelled'
  priority, cadenceId, cadenceStep, isAutoGenerated
  completedAt, completedBy, outcome, snoozedFrom, snoozeReason

campaigns/{campaignId}
  name, channel   // 'facebook'|'instagram'|'whatsapp'|'field'|'referral'|'radio'|'other'
  objective, status, startDate, endDate
  budgetMinor, spendToDateMinor          // maintained transactionally on spend write
  ownerId, teamId, externalId            // Meta campaign id
  targetRegion, targetEventTypes[]

campaigns/{campaignId}/spend/{spendId}   # APPEND-ONLY (P4)
  dayKey, amountMinor, currency, impressions, clicks, leadsReported
  source: 'manual'|'meta_api'|'import', enteredBy, correctsSpendId

expenses/{expenseId}                     # APPEND-ONLY (P4)
  category   // 'ad_spend'|'salary'|'commission'|'airtime'|'data'|'transport'|'tools'|'rent'|'other'
  amountMinor, currency, incurredOn, dayKey, monthKey
  allocation: { type: 'campaign'|'staff'|'team'|'overhead', campaignId?, staffId?, teamId? }
  isRecurring, recurrenceId, description, receiptPath
  enteredBy, approvedBy, correctsExpenseId

costAllocationPolicy/{monthKey}          # §9 — the rules used for THIS month, then frozen
  overheadMethod: 'equal'|'by_leads'|'by_revenue'|'none'
  includeSalariesInCAC: bool
  includeCommissionInCAC: bool
  attributionModel: 'first_touch'|'last_touch'|'linear'
  lockedAt, lockedBy

customers/{customerId}
  name, primaryPhoneNormalized, region
  firstWonAt, eventsCount, lifetimeValueMinor, lastEventDate
  originalLeadId, originalAttribution, acquiredByUserId
  referralsGenerated, npsScore

projects/{projectId}                     # delivery after win
  customerId, leadId, eventType, eventDate
  status: 'briefing'|'design'|'client_review'|'approved'|'dispatched'|'completed'
  deliverables[{ productId, status, assetPaths[] }]
  assignedDesignerId, dueAt, deliveredAt

products/{productId}
  name, sku, category, basePriceMinor, unitCostMinor, isActive, description

rollups/{scope}_{periodKey}              # §8.9 — PRECOMPUTED DASHBOARD DOCS (P9)
  # e.g. rollups/org_2026-08, rollups/user_abc123_2026-W35, rollups/campaign_xyz_2026-08
  scope: 'org'|'user'|'team'|'campaign'|'channel', scopeId
  period: 'day'|'week'|'month', periodKey
  leadsCreated, leadsContacted, leadsQualified, leadsWon, leadsLost, leadsParked
  revenueMinor, adSpendMinor, staffCostMinor, overheadMinor, totalCostMinor
  cacMinor, cplMinor, winRate, avgDealValueMinor, avgSalesCycleDays
  avgFirstResponseMins, contactRate, tasksOverdue
  computedAt, version, cohortBasis: 'cohort'|'period', attributionModel

rollupsPublic/{scope}_{periodKey}        # volume metrics only — readable by agents (§7.2)

notifications/{uid}/items/{itemId}
  type, title, body, leadId, isRead, createdAt

auditLogs/{logId}                        # P4, P10
  actorId, action, targetCollection, targetId, before, after, at

settings/{docId}                         # 'pipeline'|'lossReasons'|'cadences'|'sources'|'org'
  ...config payloads

importJobs/{jobId}
  fileName, storagePath, status, rowsTotal, rowsOk, rowsFailed, errors[], createdBy
```

### 6.3 Required composite indexes

**`orgId` leads every index**, because it leads every query — see B22. The authoritative
list is `firestore.indexes.json` (15 composites); the sketch below is the shape.

Add each **at the moment you write the query**, not later.

```
leads:      ownerId ASC, stage ASC, nextActionAt ASC
leads:      ownerId ASC, leadStatus ASC, updatedAt DESC
leads:      ownerId ASC, isStale ASC, nextActionAt ASC        // the "rotting" list
leads:      teamId ASC, stage ASC, eventDate ASC
leads:      orgId ASC, monthKey ASC, stage ASC
leads:      orgId ASC, leadStatus ASC, eventDate ASC          // urgency board
leads:      attribution.campaignId ASC, leadStatus ASC, createdAt DESC
tasks:      ownerId ASC, status ASC, dueAt ASC
tasks:      teamId ASC, status ASC, dueAt ASC
expenses:   allocation.staffId ASC, monthKey ASC
expenses:   allocation.campaignId ASC, monthKey ASC
activities (collection group): byUserId ASC, at DESC
```

### 6.4 Duplicate prevention — the phone lock

**Why this matters more than it looks.** The same bride WhatsApps three different Haflaway staff.
Without a lock you get three leads, three follow-up sequences annoying one customer, and a
three-way commission fight.

On lead create, run a **transaction** that:

1. Normalises the phone to E.164 (`+255…`) with `libphonenumber-js`, default region `TZ`.
2. Attempts `create` (not `set`) on `leadPhoneIndex/{phoneNormalized}`.
3. If it already exists → abort, return the existing `leadId` and `ownerId`, and show the UI a
   "this number already belongs to <owner>" screen with a **Request transfer** action.

Also run a soft check (same name + event date within ±2 days) and warn. Only the phone is a hard
block.

---

## 7. Security & access model

### 7.1 Roles

| Role | Leads | Costs & CAC | Users | Settings |
|---|---|---|---|---|
| `agent` | CRUD **own**, read unassigned pool, claim | own performance only, **no cost figures** | self | none |
| `manager` | read/write **team**, reassign within team | team CAC, campaign spend | read team | none |
| `finance` | read all, no edit | **full CRUD on expenses & campaign spend**, all CAC | read | cost policy |
| `admin` | full | full | full | full |
| `viewer` | read all, no write | aggregates only | none | none |

Role lives in **both** `users/{uid}` *and* a Firebase Auth **custom claim** (`role`, `teamId`,
`orgId`). Rules read the claim (free); the UI reads the doc (richer). A script or Cloud Function
keeps them in sync — **the claim is the authority**.

### 7.2 Rules requirements — write a test for every line

- [ ] Default deny at root.
- [ ] Helpers: `isSignedIn()`, `hasRole(...)`, `isOwner(res)`, `sameTeam(res)`, `isActiveUser()`.
- [ ] Agents cannot read `expenses`, `campaigns/*/spend`, or cost fields in rollups.
      → this is why rollups are split into `rollups` (costs, restricted) and `rollupsPublic`.
- [ ] `activities`: `create` allowed; `update` only to set `isVoided`; `delete` never.
- [ ] `expenses` and `spend`: `create` for finance/admin; `update`/`delete` **never** — corrections
      are new docs carrying `correctsExpenseId` / `correctsSpendId`.
- [ ] Stage transitions validated in rules against the §5.2 matrix.
- [ ] `ownerId` may only change by manager/admin (anti-poaching).
- [ ] `attribution` immutable after create.
- [ ] `createdBy` / `updatedBy` must equal `request.auth.uid`.
- [ ] Storage rules: receipts → finance/admin only; design assets → project members only.
- [ ] Deactivated users (`isActive: false`) denied everything.

### 7.3 Privacy

We hold personal data of prospects and, through guest lists, of third parties.

- [ ] Consent flags on the lead (`marketingConsent`, `consentCapturedAt`, `consentSource`).
- [ ] Retention: `disqualified` / `lost` leads have PII purged after 24 months (configurable).
- [ ] Admin actions: export-my-data, delete-my-data.
- [ ] Guest-list files in Storage: access restricted and logged to `auditLogs`.
- [ ] **Confirm obligations under Tanzania's Personal Data Protection Act (2022) and its
      regulations with counsel before launch.** This checklist is not legal advice.

---

## 8. Metrics — the exact math

**This section is the contract.** Implement every formula in one shared module
(`src/domain/metrics.js`) and unit-test each. No component may compute a metric inline.

### 8.1 Volume
```
leadsCreated(P)    = count(leads where createdAt ∈ P)
leadsContacted(P)  = count(leads where firstContactedAt ∈ P)
leadsWon(P)        = count(leads where closedAt ∈ P and stage = 'won')
leadsLost(P)       = count(leads where closedAt ∈ P and stage = 'lost')
contactRate(P)     = leadsContacted(P) / leadsCreated(P)
```

### 8.2 Conversion
```
qualificationRate = qualified / contacted
winRate           = won / (won + lost)     // closed deals only — never divide by all leads
lossRate          = lost / (won + lost)
funnelDropoff[s]  = 1 - (entered stage s+1 / entered stage s)
```

### 8.3 Money in
```
revenue(P)        = Σ dealValueMinor of leads won in P
avgDealValue(P)   = revenue(P) / leadsWon(P)
grossMargin(P)    = revenue(P) - Σ unitCost of products delivered in P
```

### 8.4 Money out — three buckets
```
adSpend(P)   = Σ campaign spend entries in P + Σ expenses{category='ad_spend'} in P
staffCost(P) = Σ expenses{category ∈ (salary, commission, airtime, data, transport)} in P
overhead(P)  = Σ expenses{allocation.type='overhead'} in P

totalCost(P) = adSpend
             + staffCost · (policy.includeSalariesInCAC)
             + overhead  · (policy.overheadMethod ≠ 'none')
```
Policy flags come from `costAllocationPolicy/{monthKey}` (§9). **Always display which flags were
active** beside the number.

### 8.5 CAC — three flavours, three different questions

```
CAC_blended(P)     = totalCost(P) / newCustomers(P)
                     → "What did a customer cost us on average?"

CAC_campaign(c,P)  = [ spend(c,P) + allocatedStaffCost(c,P) ] / customersAttributedTo(c,P)
                     → "Is this ad campaign worth running?"
                     allocatedStaffCost splits staff cost pro-rata by leads handled from c

CAC_staff(u,P)     = [ staffCost(u,P) + campaignSpendAttributedTo(u,P) + overheadShare(u,P) ]
                     / customersWonBy(u,P)
                     → "Is this person profitable?"
```

**Guard rails — implement these; they prevent embarrassing dashboards.**

- Denominator = 0 → render `—` with tooltip "no customers won in period". **Never `∞`, never `0`.**
- Fewer than 3 customers won in the period → mark **"low confidence"** and grey the figure. Small
  denominators make CAC-per-staff wildly noisy, and this number *will* appear in performance reviews.
- Always print the denominator: `TZS 42,000 (n=7)`.

### 8.6 Efficiency & health
```
CPL(P)            = adSpend(P) / leadsCreated(P)
CPQL(P)           = adSpend(P) / leadsQualified(P)
ROAS(c,P)         = revenueAttributedTo(c,P) / spend(c,P)
LTV               = avgDealValue × avgEventsPerCustomer × grossMarginRate
LTV:CAC           = LTV / CAC_blended    // ≥3 is the usual rule of thumb — a heuristic, not a law
paybackDays       = CAC / revenuePerCustomerPerDay
salesCycleDays    = MEDIAN(closedAt - createdAt) for won leads   // median: outliers wreck the mean
firstResponseMins = MEDIAN(firstContactedAt - createdAt)         // the top controllable lever
pipelineValue     = Σ dealValueMinor of open leads
weightedPipeline  = Σ dealValueMinor × stageWinProbability
staleLeads        = count(open leads where nextActionAt < now)
unreachableRate   = count(stage='unreachable') / count(open leads)
```

### 8.7 Scores — fixed formulas for v1
```
urgencyScore (0..100), from daysToEvent:
    ≤7 → 100 · ≤14 → 85 · ≤30 → 70 · ≤60 → 50 · ≤90 → 30 · >90 or unknown → 10

qualificationScore = 0.35·budgetBandScore + 0.25·hasDecisionMaker
                   + 0.20·guestCountScore + 0.20·scopeDefinedScore          → 0..100

priorityScore      = 0.5·urgencyScore + 0.3·qualificationScore + 0.2·engagementScore
                     engagementScore rewards recent two-way contact,
                     penalises consecutiveNoAnswer
```
`priorityScore` drives the default sort of every agent's work queue. Recompute on every lead write
**and nightly**, because `daysToEvent` decays on its own.

### 8.8 Cohort vs period (P6) — a non-negotiable UI rule

Every CAC and conversion chart carries a visible toggle and this caption:

> **Cohort view** — spend and outcomes attributed to the month the **lead was created**. Answers
> "was August's marketing money well spent?" Incomplete for recent months, since deals are still open.
>
> **Period view** — outcomes counted in the month the deal **closed**. Answers "how did we do in
> August?" Mixes in spend from earlier months.

Default: **cohort**, with an "incomplete cohort" banner whenever
`monthKey >= currentMonth - ceil(avgSalesCycleDays / 30)`.

### 8.9 Computation strategy (P9)

| Tier | Mechanism | Use for |
|---|---|---|
| **Live** | Firestore aggregation queries (`count()`, `sum()`, `average()`) from the client SDK — cheap, no extra infrastructure | Single-scope numbers: "my open leads", "team won this week" |
| **Rolled up** | `rollups/{scope}_{periodKey}` docs, written (a) transactionally on lead close / spend entry and (b) by a nightly recompute | Dashboards, trend charts, anything needing GROUP BY |
| **Recomputed** | An idempotent `recomputeRollups(scope, period)` runnable on demand by an admin | Backfills, corrections, after a policy change |

**Nightly job — three options, decide in §17 (D1):**

1. **Cloud Functions (Blaze plan) + Cloud Scheduler** — the right answer. ⚠️ Requires upgrading off
   the free Spark plan.
2. **A GitHub Action on a cron** running a Node script with the Admin SDK — free, adequate,
   slightly grubby. Good interim.
3. **Client-side trigger** — the first admin to open the dashboard each day triggers a recompute.
   Fragile; last resort.

Rollup docs must be **idempotent and versioned** (`computedAt`, `version`) so a re-run is always safe.

---

## 9. Cost allocation policy — the hard, political part

CAC-per-staff is only as honest as the cost data behind it. Decide these **before** building the
dashboard, record them in `costAllocationPolicy/{monthKey}`, and **freeze the month** once payroll
is agreed.

- [ ] **Direct campaign cost** → `allocation.type = 'campaign'`. Unambiguous.
- [ ] **Direct staff cost** → salary, commission, airtime, data bundles, transport to committee
      meetings → `allocation.type = 'staff'`. Recurring entries generated monthly.
- [ ] **Shared overhead** (rent, tools, admin salaries) → `allocation.type = 'overhead'`,
      distributed by the month's `overheadMethod`:
      - `equal` — every active agent carries the same share. Simple; punishes part-timers.
      - `by_leads` — pro-rata by leads handled. Rewards volume, punishes quality.
      - `by_revenue` — pro-rata by revenue closed. Rewards closers. **Recommended default.**
      - `none` — exclude overhead from CAC. Cleanest for comparing *marketing* efficiency.
- [ ] **Commission** — decide whether it belongs in CAC. For: it is a real acquisition cost.
      Against: it varies with revenue, so including it makes CAC rise with success and distorts
      channel comparison. **Recommendation: exclude from CAC; report separately as cost-of-sale.**
      (`includeCommissionInCAC: false`.)
- [ ] **Month lock**: after `lockedAt`, that month's expenses can only be *corrected* by a new entry
      in the current month referencing the old one. No retro-editing of history (P4).
- [ ] **Attribution model** for the month is frozen in the same document, so a chart rendered in
      December about August still reflects August's rules.

**Deliverable:** a one-page "How we calculate CAC at Haflaway", generated from the policy and linked
from every CAC dashboard. When someone disputes their number, that page ends the argument.

---

## 10. Follow-up cadence engine

This directly answers *"leads were unreachable… allow them to set periods for which they will check
them out."* Treat it as the core product, not a reminder widget.

### 10.1 Model

A **cadence** is a named, ordered list of steps stored in `settings/cadences`:

```js
{
  id: 'unreachable_standard',
  name: 'Unreachable — standard chase',
  appliesToStage: 'unreachable',
  steps: [
    { offset: '2h', channel: 'call',     label: 'Retry call'            },
    { offset: '1d', channel: 'whatsapp', label: 'WhatsApp message'      },
    { offset: '3d', channel: 'call',     label: 'Call — different time' },
    { offset: '7d', channel: 'whatsapp', label: 'Final check-in'        },
  ],
  onExhaust: { stage: 'parked', parkReason: 'no_response_after_cadence' },
  quietHours: { start: '21:00', end: '07:30' },   // Africa/Dar_es_Salaam
  skipDays: ['sunday'],
}
```

Ship these presets in v1:

| Cadence | Trigger | Shape |
|---|---|---|
| `unreachable_standard` | stage → `unreachable` | as above |
| `event_imminent` | event ≤14 days away | daily touch; escalate to manager at step 3 |
| `nurture_long` | event >90 days away | +30d, +60d, then 30 days before the event |
| `post_quote` | stage → `quoted` | +2d, +5d, +10d → `lost` with reason `no_decision` |
| `committee_wait` | contact says "the committee meets on…" | next touch = `committeeMeetsOn + 1 day` |

### 10.2 Behaviour

- [ ] Entering a stage with a matching cadence **auto-creates the next `task`** — exactly one open
      task per lead at a time, never a pile.
- [ ] Completing a task with outcome `spoke` exits the cadence and prompts for the next manual action.
- [ ] Outcome `no_answer` advances to the next step and increments `consecutiveNoAnswer`.
- [ ] **Manual override always available**: a "Remind me…" control with quick chips —
      *2 hours · Tomorrow 9am · After their committee meeting · Custom date & time*. This is the
      literal user request; keep it one tap from the lead screen.
- [ ] Snoozing requires a `snoozeReason` — that data becomes the loss-reason analysis later.
- [ ] Quiet hours and skip-days push `dueAt` forward. Never schedule a call for 11pm.
- [ ] Cadence exhaustion applies `onExhaust` and writes a `system` activity explaining why.
- [ ] **Escalation**: any open lead more than 72h past `nextActionAt` appears on the manager's
      dashboard and fires a notification.
- [ ] Overdue tasks are the loudest thing in the UI: nav badge, red row, top of the work queue.

### 10.3 Work queue — the agent's home screen

One screen, three sections, each sorted by `priorityScore`:

1. **Overdue** (red) — `nextActionAt < now`
2. **Today** — due today
3. **Coming up** — next 7 days

Each row shows: name · event type and countdown (`Harusi · in 12 days`) · last outcome · one-tap
actions (**Call**, **WhatsApp**, **Log**, **Snooze**). Nothing else. P7 applies at full force.

---

## 11. Architecture & tech decisions

### 11.1 Stack — locked unless §17 says otherwise

| Concern | Choice | Why |
|---|---|---|
| Framework | **Vue 3 `<script setup>` + Vite** | Already scaffolded |
| Routing | **Vue Router 4** | Standard |
| State | **Pinia** | Stores wrap Firestore subscriptions |
| Styling | **Tailwind CSS** + **shadcn-vue** (Reka UI) | Fast, accessible primitives, no theme lock-in |
| Data layer | **Firebase modular SDK** behind hand-written composables | Full control of listener lifecycle = read-cost control |
| Charts | **Chart.js** via `vue-chartjs` | Light; covers every chart in §12 |
| Tables | **TanStack Table (Vue)** | Headless, virtualised, sortable |
| Forms | **vee-validate** + **zod** | Same zod schemas reusable in Admin-SDK scripts |
| Dates | **date-fns** + **date-fns-tz** | Correct `Africa/Dar_es_Salaam` handling |
| Phones | **libphonenumber-js** | E.164 normalisation is load-bearing (§6.4) |
| i18n | **vue-i18n** | Swahili + English (§13) |
| PWA | **vite-plugin-pwa** | Installable, offline shell |
| Tests | **Vitest** · **@firebase/rules-unit-testing** · **Playwright** | unit / rules / e2e |
| Errors | **Sentry** | Field bugs are otherwise invisible |

### 11.2 Folder structure

```
src/
  main.js
  App.vue
  router/            index.js, guards.js
  firebase/          app.js, auth.js, db.js, storage.js, converters.js
  stores/            auth.js, leads.js, tasks.js, campaigns.js, expenses.js, ui.js
  domain/            # PURE FUNCTIONS — no Firebase imports, 100% unit-tested
    metrics.js       #  §8 formulas
    stages.js        #  §5.2 state machine + canTransition()
    scoring.js       #  §8.7
    cadence.js       #  §10 next-step calculation
    money.js         #  minor-unit arithmetic + formatting
    phone.js         #  E.164 normalisation
    periods.js       #  dayKey / weekKey / monthKey, timezone-correct
  services/          # Firestore I/O — thin, transactional, emulator-tested
    leads.service.js  tasks.service.js  expenses.service.js  rollups.service.js
  composables/       useCollection.js, useDoc.js, useAggregate.js, useOnline.js, usePermissions.js
  components/        ui/  leads/  tasks/  charts/  layout/
  views/             auth/  leads/  tasks/  campaigns/  finance/  analytics/  admin/
  locales/           en.json, sw.json
functions/           # optional, Phase 6+ (requires Blaze)
scripts/             seed.js, recomputeRollups.js, syncClaims.js, backup.js
tests/               unit/  rules/  e2e/
firestore.rules  firestore.indexes.json  storage.rules  firebase.json  .firebaserc
```

**Hard rule:** `src/domain/` must not import Firebase. It stays pure, fast to test, and portable if
we ever leave Firestore.

### 11.3 Read-cost discipline (P9)

At 50 users, careless listeners are the main cost and battery risk.

- [ ] Never `onSnapshot` a whole collection. Always `where` + `orderBy` + `limit(25)` + pagination.
- [ ] Real-time only where it earns its keep: my work queue, the lead currently open, my
      notifications. Everything else is one-shot `getDocs` with a manual refresh.
- [ ] Dashboards read **rollup docs** (~5 reads), never raw leads.
- [ ] Unsubscribe every listener on unmount — enforced by the `useCollection` composable. Never
      call `onSnapshot` directly inside a component.
- [ ] Enable `persistentLocalCache` with the multi-tab manager; cache-served reads are free.
- [ ] Add a dev-only read-counter overlay so regressions are visible while building.

---

## 12. Screens to build

| # | Screen | Primary user | Notes |
|---|---|---|---|
| 1 | Login / password reset | all | Email + password v1; phone OTP later |
| 2 | **Work Queue** (home) | agent | §10.3 — the most important screen in the app |
| 3 | Lead list — filter, search, saved views | agent, manager | Virtualised table + mobile card view |
| 4 | **Lead detail** | agent | Header (name, countdown, stage, owner) · timeline · contacts · quote · quick actions |
| 5 | Quick-add lead | agent | ≤20s, mobile-first, phone-first, inline dedupe check (P7) |
| 6 | Pipeline board (kanban by stage) | manager | Drag = stage change, validated by the state machine |
| 7 | **Urgency board** — sorted by event date | agent, manager | P2 made visible; our signature screen |
| 8 | Calendar — tasks + event dates | agent | Month / week |
| 9 | Campaigns list & detail | manager, finance | Spend entry, CPL, ROAS, attributed leads |
| 10 | Expenses & recurring costs | finance | Receipt upload to Storage |
| 11 | **CAC dashboard** | admin, finance | Blended / per campaign / per staff, cohort toggle (§8.8) |
| 12 | Performance dashboard — weekly & monthly | admin, manager | Investment · leads · won · lost · trends |
| 13 | Staff leaderboard & scorecards | manager | Volume, win rate, response time, CAC (with `n=` and low-confidence flags) |
| 14 | Customers & repeat business | manager | LTV, referral tree |
| 15 | Projects / delivery board | ops | Post-win fulfilment |
| 16 | Admin — users, roles, teams, targets | admin | |
| 17 | Admin — settings (stages, loss reasons, cadences, products) | admin | |
| 18 | Import / export | admin | CSV in; CSV + PDF out |
| 19 | Audit log viewer | admin | |
| 20 | Notifications centre | all | |

---

## 13. Localisation & field reality

- [ ] **Swahili first, English second.** Sales staff work in Swahili; the dashboard audience is
      bilingual. Default from the user's `locale`, switchable in the profile.
- [ ] Currency **TZS**, `en-TZ` formatting, no decimals in the UI (`TZS 150,000`), integer minor
      units in storage.
- [ ] Timezone **Africa/Dar_es_Salaam** everywhere. Never rely on the browser's local time for
      business-day boundaries.
- [ ] Event vocabulary in the UI: *Harusi*, *Send-off*, *Kitchen party*, *Mahafali*, *Kumbukumbu*,
      *Corporate*, *Other*.
- [ ] Low-bandwidth mode: compress uploads client-side, lazy-load images, keep the initial bundle
      under 250 KB gzipped.
- [ ] **Test on a low-end Android phone over throttled 3G.** Not optional — that is the deployment
      environment.

---

## 14. Integrations

| Integration | Phase | Approach | Reality check |
|---|---|---|---|
| **WhatsApp — outbound** | 1 | `wa.me/<phone>?text=<template>` deep links; the agent sends from their own WhatsApp; the app logs the activity | Free, zero infrastructure, works today. Not automated — the agent taps send. |
| **WhatsApp Business Cloud API** | 4 | Meta Cloud API, template messages, inbound webhook | Needs Meta Business verification, a WABA, and **pre-approved templates**. Business-initiated messages outside the 24-hour customer-service window must use approved templates and are charged. Budget real calendar time for approval. |
| **Meta Lead Ads** | 3 | Lead Ads webhook → endpoint → Firestore, preserving `campaignId`/`adId` into `attribution` | Requires an HTTPS endpoint (Cloud Function) and app review. Interim: hourly CSV export + importer. |
| **Meta ad-spend sync** | 4 | Marketing API → nightly job → `campaigns/*/spend` | Removes manual spend entry — the single biggest data-quality risk in the CAC pipeline. |
| **UTM capture on the website** | 2 | Landing form writes `utm_*` and `fbclid` into `attribution` | Cheap, high value. Do it early. |
| **SMS reminders** | 3 | Local aggregator (Beem, Africa's Talking, Infobip) | Usually cheaper and more reliable than WhatsApp for bulk event reminders in TZ. Compare per-message pricing and delivery rates. |
| **Push notifications** | 3 | FCM web push | On iOS Safari, web push requires the PWA to be installed to the home screen. |
| **Payments — M-Pesa / Tigo Pesa** | 5 | Log payments manually in v1; aggregator API later | Manual is fine at this volume. Do not build payments before the CRM works. |
| **CSV / Sheets export** | 2 | Client-side CSV | Management will want it on day one. Ship it early and kill the shadow spreadsheets. |

---

# BUILD QUEUE

---

## Phase 0 — Foundations  ← START HERE

- [x] Create the Firebase project; enable **Auth (Email/Password)**, **Firestore (Native mode)**,
      **Storage**. ⚠️ The Firestore **region is permanent** — see D2.
- [x] `npm i firebase pinia vue-router` · `npm i -D firebase-tools`
- [x] `firebase init` → firestore, storage, hosting, emulators. Commit `firebase.json`,
      `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`.
- [x] Configure the **Emulator Suite** (auth, firestore, storage, ui); add `npm run dev:emulators`.
      **All development runs against emulators**, never production.
- [x] `src/firebase/app.js` — init from `import.meta.env.VITE_FB_*`; auto-connect to emulators when
      `import.meta.env.DEV`.
- [x] Commit `.env.example`; gitignore `.env*`. (Current `.gitignore` covers `*.local` only.)
- [x] Enable **`persistentLocalCache`** with `persistentMultipleTabManager` (P8).
- [x] Install and configure Tailwind v4; define design tokens (colour, spacing, radius). *(shadcn-vue dropped — see B1)*
- [x] Vue Router with layouts (`AuthLayout`, `AppLayout`) and a placeholder route per §12 screen.
- [x] Pinia installed; `stores/ui.js` with a global toast and an offline banner.
- [ ] ESLint + Prettier + a pre-commit hook.
- [x] Vitest configured, with one passing test in `src/domain/`.
- [x] `vite-plugin-pwa` with an offline app shell and an install prompt. *(precaches 38 entries; manifest + icons via `scripts/make-icons.mjs`)*
- [x] Replace the Vite template README with a real one: setup, emulators, seeding, deploy.
- [x] **Initialise git** — this directory is not yet a repository. *(initialised; no remote yet, nothing committed)*

## Phase 1 — Identity & access

- [x] `stores/auth.js` — `onAuthStateChanged`, user-doc hydration, custom-claim reading.
- [x] Login, logout, password reset, and an "account deactivated" screen.
- [x] Router guards: `requiresAuth`, `requiresRole([...])`, redirect-after-login.
- [x] `users/{uid}` bootstrap on first login — **self-service registration**: `/register` creates an org + its admin (`registerOrganization()`); `scripts/bootstrap-admin.js` remains for admin-only appointment into an existing org without the browser. See D7.
- [x] `scripts/syncClaims.js` (Admin SDK) — set `role`, `teamId`, `orgId` custom claims.
- [x] Admin UI: set role / team, deactivate, with a prominent "claims not synced yet" warning. *(invite flow still to build)*
- [ ] `usePermissions()` composable and a `<Can :do="…">` wrapper for UI gating. *(`auth.can` object exists and is used by the nav; the wrapper component is not built)*
- [x] **Write `firestore.rules` for §7 plus a rules test suite.** Rules before features, always.
- [x] Seed script: 1 admin, 2 managers, 8 agents, 2 teams.

## Phase 2 — Lead core

- [x] `src/domain/phone.js` + tests (TZ formats: `0712…`, `+255712…`, `255712…`, spaces, dashes).
- [x] `src/domain/periods.js` — timezone-correct `dayKey` / `weekKey` / `monthKey` + tests.
- [x] `src/domain/money.js` — minor-unit arithmetic and TZS formatting + tests.
- [ ] Firestore converters (`withConverter`) for `Lead`, `Task`, `Activity`.
- [x] **`leads.service.js#createLead()`** — transactional, with the `leadPhoneIndex` lock (§6.4).
- [x] Quick-add form: phone → name → event type → event date → source. **Time it: ≤20s.**
- [x] Inline duplicate warning with the "already owned by X — request transfer" path.
- [x] Lead list: filters (stage, text search incl. phone lookup), mobile cards. *(saved views, virtualisation and pagination deferred — the working set is one query)*
- [x] Lead detail: header, stage control, contacts sub-list, timeline.
- [x] **Activity logging** — `LogActivityDialog`, outcome → snooze → save. Append-only.
- [ ] Contacts subcollection CRUD with roles, `isPrimary`, `isDecisionMaker` (P3).
- [ ] Attachment upload to Storage (`leads/{leadId}/…`) with client-side image compression.
- [ ] Owner reassignment (manager+) writing an `assignment` activity.
- [ ] CSV import with column mapping, dry-run preview and a dedupe report → `importJobs`.
- [ ] **Offline test**: aeroplane mode → create a lead, log two activities → reconnect → verify sync.

## Phase 3 — Pipeline & qualification

- [x] `src/domain/stages.js` — the §5.2 state machine, `canTransition()`, and a full test matrix.
- [x] Enforce transitions in **both** the client and `firestore.rules`.
- [x] Stage-change modal with required fields per target stage (loss reason, deal value, park reason).
- [ ] BEDS qualification panel (§5.3), gating entry to `qualified`.
- [ ] `src/domain/scoring.js` — urgency / qualification / priority (§8.7) + tests.
- [ ] Recompute scores on lead write; nightly job refreshes `daysToEvent` and `urgencyScore`.
- [x] Kanban pipeline board with validated drag-and-drop, stage totals and counts.
- [x] **Urgency board** — open leads sorted by event date, colour-banded by `daysToEvent` (P2).
- [ ] Loss-reason taxonomy in `settings/lossReasons`: `price`, `chose_competitor`,
      `did_it_themselves`, `event_cancelled`, `no_budget`, `no_response`, `wrong_fit`, `other`.
      Free-text notes required for `other`.
- [ ] Products catalogue + quote builder → PDF to Storage → `quote_sent` activity.
- [ ] Won flow: capture deal value and deposit, then create `customers` and `projects` atomically.

## Phase 4 — Follow-up engine  ★ highest business value

- [ ] `src/domain/cadence.js` — next-step calculation, quiet hours, skip days + tests.
- [ ] `tasks` collection and service; auto-create the next task on stage entry.
- [ ] Ship the five preset cadences from §10.1 into `settings/cadences`.
- [x] **Work Queue** screen (§10.3): overdue / today / upcoming, sorted by `priorityScore`.
- [x] "Remind me…" quick chips: 2h · Tomorrow 9am · 3 days · After committee · 1 week. *(custom date-time picker still to add)*
- [ ] Task completion flow capturing the outcome, which advances or exits the cadence.
- [ ] Snooze with a required reason.
- [ ] Cadence exhaustion → `parked` plus an explanatory `system` activity.
- [ ] Stale-lead detection (`isStale`) refreshed nightly; red badges in nav and lists.
- [ ] Manager escalation view: leads untouched more than 72h past their next action.
- [ ] Notification centre (in-app), then FCM web push.
- [ ] Calendar view combining tasks and event dates.
- [ ] **First-response SLA**: record `firstContactedAt`; alert when a new lead is untouched for
      more than 30 minutes during working hours.

## Phase 5 — Money in / money out

- [ ] Campaigns CRUD: channel, budget, dates, owner, target region.
- [ ] Append-only spend entries; `spendToDateMinor` maintained transactionally.
- [x] Expenses list + add, with the §9 allocation object. *(receipt upload still to build)*
- [ ] Recurring expense templates (monthly salary / airtime per staff) plus a generator script.
- [ ] `costAllocationPolicy/{monthKey}` editor and **month lock**, with an audit entry.
- [ ] Cost-side rules and tests: agents get **zero** read access to expenses or spend.
- [ ] Payment logging on leads (deposit / balance) feeding `depositPaidMinor`.
- [ ] Finance summary: spend by category, by campaign, by staff, month over month.

## Phase 6 — Analytics & CAC

- [x] `src/domain/metrics.js` — **every formula in §8**, pure and exhaustively unit-tested,
      including the zero-denominator and low-confidence guard rails.
- [ ] `rollups.service.js` — read rollup docs; `recomputeRollups(scope, period)`, idempotent.
- [ ] Transactional rollup increments on: lead created, lead closed, spend entered, expense entered.
- [ ] `scripts/recomputeRollups.js` (Admin SDK); choose a scheduler from §8.9 → D1.
- [ ] Split `rollups` (with costs) from `rollupsPublic` (volumes only) and enforce in rules.
- [x] **CAC dashboard**: blended · per campaign · per staff · per channel, cohort/period toggle, active-policy caption, `n=` denominators, low-confidence greying. *(computed live from documents; rollups still to come)*
- [ ] Performance dashboard, weekly and monthly: investment, leads created, won, lost, win rate,
      revenue, CAC, trend sparklines, period-over-period deltas.
- [x] Funnel visualisation with stage-by-stage drop-off.
- [ ] Cohort table: creation month × months-to-close.
- [x] Staff scorecards: leads, contact rate, first-response time, win rate, avg deal value, CAC.
- [x] Campaign ROI table: spend, leads, CPL, qualified, won, revenue, CAC, ROAS.
- [x] Loss-reason breakdown; unreachable-rate trend.
- [ ] **Drill-down on every figure** (P11) → a filtered lead or expense list.
- [ ] CSV export from any dashboard; monthly PDF summary.
- [ ] Seasonality view (wedding-season peaks) once there are ≥12 months of data.

## Phase 7 — Delivery, customers & LTV

- [ ] Projects board: briefing → design → client review → approved → dispatched → completed.
- [ ] Deliverables checklist per project; asset uploads; designer assignment.
- [ ] Customer profile: all events, lifetime value, referral tree.
- [ ] Repeat-business prompt: auto-create a nurture lead ~11 months after a wedding.
- [ ] **Referral capture** — the guest list of one event is the lead list of the next. Track
      `referrerCustomerId` and report referral CAC (usually the lowest; prove it, then fund it).
- [ ] Post-delivery feedback / NPS capture.

## Phase 8 — Integrations

- [ ] WhatsApp deep links with per-stage message templates (Swahili + English).
- [ ] Website lead form capturing `utm_*` and `fbclid` into `attribution`.
- [ ] Meta Lead Ads ingestion — webhook if on Blaze, otherwise a scheduled CSV import.
- [ ] Meta Marketing API nightly spend sync into `campaigns/*/spend`.
- [ ] SMS provider for bulk event reminders (evaluate Beem vs Africa's Talking on price and delivery).
- [ ] FCM push notifications.
- [ ] WhatsApp Cloud API — only after templates are approved.

## Phase 9 — Hardening

- [ ] Rules test suite covering **every** role × collection × operation.
- [ ] Playwright e2e: agent day-in-the-life; manager reassignment; finance month-close.
- [ ] Load test: seed 50k leads and 500k activities; verify list, board and dashboard latency.
- [ ] Read-cost audit — measure reads per screen against a budget; fix the worst offenders.
- [ ] Bundle-size budget (<250 KB gzipped initial) and route-level code splitting.
- [ ] Sentry error tracking plus a user-facing "report a problem" button.
- [ ] Scheduled Firestore exports to a GCS bucket, plus a documented and **rehearsed** restore.
      An untested backup is not a backup.
- [ ] Accessibility pass: keyboard navigation, focus management, contrast, screen-reader labels.
- [ ] Real-device testing on a low-end Android over throttled 3G.
- [ ] Security review: Firestore rules, Storage rules, dependency audit, secret scan.

## Phase 10 — Launch & operations

- [x] Deploy scripts (`deploy:rules` before `deploy:hosting`) and **[DEPLOY.md](DEPLOY.md)**. *(separate prod project and CI still to do)*
- [ ] Seed real data: users, teams, products, campaigns, historic expenses.
- [ ] Historic lead import — a best-effort backfill so the first dashboards are not empty.
- [ ] **Swahili training guide plus five short screen-recorded videos.** Adoption is the real risk (P7).
- [ ] Pilot with one team of 5–8 for two weeks. Instrument it: time-to-log-a-lead, daily active
      users, tasks completed on time. **Fix the friction before rolling out to 50.**
- [ ] Launch success metrics: ≥90% of leads logged same-day · ≥80% of tasks actioned within 24h of
      due · median first response <30 minutes.
- [ ] Weekly management review ritual built on the Performance dashboard — the system only creates
      value if somebody acts on it.
- [ ] Runbook: correcting an expense, reassigning a lead, unlocking a month, recomputing rollups,
      restoring from backup.

## Phase 11 — Later (do not build early)

- [ ] Configurable pipeline stages per team
- [ ] Lead-scoring rules engine / ML propensity model *(needs ≥12 months of clean outcome data)*
- [ ] Commission calculator driven by won deals
- [ ] Customer self-service portal (approve designs, view RSVPs)
- [ ] RSVP and guest-list products feeding back into the CRM as a lead source
- [ ] Native wrapper (Capacitor) if PWA push/offline proves insufficient on iOS
- [ ] Multi-currency / multi-country
- [ ] Territory management by region
- [ ] AI call-note summarisation and next-best-action suggestions

---

## 15. Non-functional requirements

| Requirement | Target |
|---|---|
| New lead entry | ≤20 seconds on a mid-range Android phone (P7) |
| Log an interaction | ≤3 taps |
| Lead list first paint | <1.5 s on 3G |
| Dashboard load | <2 s, ≤10 Firestore reads |
| Offline | Full read + write for the agent's own leads and tasks |
| Availability | Firebase SLA; degrade to cached data, never to a blank screen |
| Concurrent users | 50 active, 200 peak sessions |
| Data volume (year 1) | ~50k leads, ~500k activities |
| Backup | Daily export, 30-day retention, restore rehearsed quarterly |
| Bundle | <250 KB gzipped initial route |

## 16. Definition of Done

A task is done when **all** of these hold:

- [ ] Works offline wherever §15 requires it
- [ ] `firestore.rules` updated **and** covered by a rules test
- [ ] Composite indexes added to `firestore.indexes.json`
- [ ] Pure logic lives in `src/domain/` with unit tests
- [ ] Mobile layout verified at 360 px width
- [ ] Swahili and English strings both present
- [ ] Errors surface a human message, not a Firebase error code
- [ ] Loading, empty and error states all designed
- [ ] Read cost checked — no unbounded listeners
- [ ] §6 of this document updated if the data shape changed

## 16a. Build log — decisions taken and deviations from this plan

Recorded as they happened, so nobody has to reverse-engineer them from git.

| # | Decision / deviation | Why |
|---|---|---|
| B1 | **shadcn-vue dropped** in favour of Tailwind v4 plus hand-written component classes (`.btn`, `.field-*`, `.card` in `src/style.css`). | shadcn-vue's Tailwind v4 support adds a CLI, a registry and a component-vendoring step for what is currently five primitives. Revisit when a real dialog/combobox/date-picker is needed — probably Phase 3. |
| B2 | `@date-fns/tz` (`TZDate`) instead of `date-fns-tz`. | date-fns v4's supported timezone story. `date-fns-tz` was installed, unused, and has been removed. |
| B3 | **Unit tests run with `TZ=America/New_York`** (pinned in `vite.config.js`). | Development machines here run `Africa/Nairobi`, which shares Dar es Salaam's UTC+3 offset. That made every timezone bug in `periods.js` invisible — a broken 23-hour "org day" passed a test asserting it was exactly 24 hours. The suite must run somewhere the code has to actually work. |
| B4 | **`firestore.rules` sub-collections use `get()` on the parent lead.** | Inside `match /leads/{id}/activities/{id}`, `resource` is the *activity*, so the lead-scoped helpers were reading `ownerId`/`orgId` off the wrong document and denying everything. Permission for a child is a property of its parent. Costs one billed read per request; identical `get()` calls are memoised within a request, so a whole timeline still costs one. |
| B5 | **`campaignsPublic/{id}`** mirror added (name + channel only). | Agents must attribute a lead to a campaign but must never see its budget (§7.1), and Firestore cannot hide a field from a reader. |
| B6 | **`rollupsPublic`** split from `rollups`. | Same reason: volume metrics are safe for agents, cost metrics are not. |
| B7 | `scripts/free-ports.mjs` added, and wired into every emulator script. | The Firestore emulator does not exit cleanly on Java 26 — its rules-runtime child throws on shutdown and the JVM holds port 8080, so the next run fails with "port taken". |
| B8 | **Bundle: 66 KB gzipped on the critical path** (app 8.2 · vendor 53 · CSS 5.6), plus ~25 KB for Auth as a dynamic import. Firestore's 170 KB now loads only AFTER sign-in. | Was ~260 KB — over the §15 budget before a single feature existed, because `stores/auth.js` imported `db` eagerly and dragged the whole Firestore SDK onto the login screen. `firebase/app.js` now exposes `getDb()` / `getStorageInstance()` as lazy accessors. **Closed.** |
| B9 | `npm audit`: 10 moderate advisories, all transitive under `firebase-admin` / `firebase-tools` (uuid buffer bounds check). | Dev dependencies only — nothing reaches the browser. Fixing requires a breaking downgrade of `firebase-tools`. Deferred to the Phase 9 dependency audit. |
| B10 | Seed script **refuses to run against anything but a local emulator**. | It writes fabricated leads and fake payroll figures. Against the real database that would poison every CAC number in the system. |
| B11 | **`priorityScore` has an urgency FLOOR** (90 inside 7 days, 75 inside 14) on top of the §8.7 weighted blend. | The §8.7 weights alone do not deliver what P2 promises. Urgency contributes at most 50 of 100 points, so an unqualified lead whose wedding is in 9 days scored **43** while a perfectly-qualified lead 7 months out scored **55** — the blend put the distant lead first. P2 says the opposite in as many words. Resolved in favour of P2, because the costs are asymmetric: both next actions are one phone call, but only one of them has a window that shuts. **Raise this if you disagree — it changes what 50 agents do all day.** |
| B13 | **`leadPhoneIndex` is keyed `{orgId}_{phoneNormalized}`, not by the bare number.** | Keying on the phone alone made it a global directory: anyone signed in could list the whole collection and harvest every claimed customer number with its owning agent, and two organisations would collide — one permanently blocking the other from capturing a lead. |
| B14 | **`usersPublic/{uid}` mirror added**; `users/{uid}` is now readable only by the owner, managers, finance and admin. | Firestore cannot project fields, so `allow read` handed over the WHOLE document — which §6.2 says carries `targets`, commission rate, phone and FCM tokens. Every agent could read every colleague's pay data. Lead lists read display names from the mirror instead. |
| B26 | **The desktop sidebar is `sticky top-0 h-dvh`; only its `nav` scrolls.** | Without a height constraint the `<aside>` stretches to match the document, so on a long list it scrolled away with the page and left the user with a floating profile footer and no navigation at all. `min-h-0` on the nav is equally load-bearing — a flex child will not shrink without it, so `overflow-y-auto` never engages. |
| B41 | **`firestore.rules` reads the claim FIRST, then falls back to `users/{uid}`.** | A browser cannot set a custom claim — `setCustomUserClaims` is Admin SDK only — so a claim-only model means no in-app screen can ever finish provisioning a colleague, and somebody always has to run a script. Firestore evaluates only the taken branch of a ternary, so a provisioned account pays **zero** extra reads; the fallback costs one document read for accounts not yet synced. `users/{uid}` becomes security-relevant, so only an admin may write `role`/`orgId`/`isActive`, and a self-update is still restricted to presentation fields. |
| B42 | **`settings/bootstrap` — a one-way latch for the first admin.** ~~Claim the sentinel (only while `claimed == false`, stamping your uid), THEN create your own admin profile, which is permitted only because step one recorded you.~~ **SUPERSEDED by B44** — the sentinel only ever supported one org per deployment, which stopped being the model. | The ORDER was the safety property: a second caller lost at step one and could do nothing at step two. Kept here as history — the mutex idea it introduced is exactly what B44 generalises to be per-orgId instead of per-deployment. |
| B43 | **The generic `settings/{docId}` rule excluded `bootstrap`.** **SUPERSEDED by B44** — the exclusion, and the collection it protected, are both gone. | Firestore evaluates every matching rule and ORs the results, so the narrower `match /settings/bootstrap` block did NOT override the generic admin-write rule — an admin could flip `claimed` back to false and reopen the one path by which somebody appoints themselves administrator. Found by the rules tests, not by reading. The lesson (a look-alike top-level collection needs its OWN match block, not an exclusion bolted onto a generic one) is why B44 gave `orgs/{orgId}` its own block instead. |
| B39 | **`scripts/bootstrap-admin.js`** — no longer the only way to mint an admin (see B44), but still the way to appoint one into an ALREADY-EXISTING org from the command line, without the browser. | Originally written because a freshly deployed project had NOBODY who could let anybody in, and `syncClaims` could not fill that gap on its own: it calls `getUserByEmail` and requires the account to already exist. The script creates the Auth user, sets the claims and writes both `users/{uid}` and `usersPublic/{uid}` — miss the claims and they land on "not set up yet"; miss the mirror and the UI shows a raw uid. Prints a password-reset link rather than setting a password, and refuses `--password` against production. |
| B44 | **Self-service org registration replaced the single-use bootstrap.** `orgs/{orgId}` is a create-only registry doc — its EXISTENCE is the uniqueness lock (Firestore only allows `create` when `resource == null`), so any signed-in caller can mint a new orgId and become its admin, repeatably. `registerOrganization()` tries candidate slugs (`acme`, `acme-2`, …) until one's `orgs/{orgId}` create succeeds. | The old sentinel could only ever crown ONE admin for the WHOLE deployment — fine for a single company, not for a general-purpose product. A per-orgId create-only lock generalises the same "existence is the claim" idea B42 introduced without needing a boolean latch, because uniqueness is now scoped to the orgId rather than to the deployment. `firestore.rules`' `orgs/{orgId}` block is deliberately its own `match`, not folded into `settings/{docId}` — see B43's lesson. Claim-syncing moved from a manual `npm run claims` to `functions/index.js`'s `onCreate` trigger on `users/{uid}`, which now also benefits admin-invited colleagues, not just self-registered admins (see D1, D7). |
| B40 | **`initializeApp({ credential: undefined })` throws** — the key being present with an undefined value is not the same as the key being absent. | `scripts/syncClaims.js` had this from the day it was written and **had never been run**; it crashed on its first real invocation. Both scripts now build the options object conditionally. A script nobody executes is not a script, it is a plan. |
| B38 | **`tests/views/mount.test.js` mounts EVERY view — with data, with no data, and as every role.** `npm run test:views`. | Written because "it compiles" was checked three separate times and shipped a blank screen anyway. `UrgencyBoardView` declared its pagers above the `sorted` computed they read; `usePagination` watches its source, `watch` evaluates that source immediately on setup, and the getter hit a `const` in its temporal dead zone. A `ReferenceError` at mount — the SFC compiled perfectly, the dev server returned HTTP 200, and the page rendered nothing. A compile check cannot catch a runtime throw. It also spies on `console.error`, because Vue reports a render error there rather than throwing out of `mount()`. Mutation-tested: reintroducing the bug fails 8 assertions. |
| B36 | **Conventional numbered paginator everywhere**: `« ‹ 1 … 9 [10] 11 … 20 › »`, current page marked with `aria-current`, per-page selector, "Showing 226–250 of 500". `ShowMoreButton` is retired from the queue and urgency board. | The window is RESPONSIVE rather than fixed: nine page targets across a 360px phone puts every one under 30px, so the window narrows (`delta 0` on mobile — first … current … last, five targets each clearing 44px) instead of the buttons shrinking. First/last jumps hide on mobile, where the ellipsis-adjacent numbers already reach them in one tap. The breakpoint is tracked in JS, not duplicated in CSS — rendering both windows and hiding one would double every page button in the tab order and announce it twice. |
| B37 | **`pageWindow()` never collapses a SINGLE page behind an ellipsis.** | A gap standing in for one page costs the reader a destination and saves no space. Found by an exhaustive property test (40 page counts × every current page × three window widths), not by inspection — the failing case was current=3 of 6 at `delta 0`. |
| B33 | **One dominant header — `components/layout/PageHeader.vue` — on every screen.** Sticky, spans the full content column, with `subtitle`, `actions` and `toolbar` slots. | Five views each drew their own `h1` + subtitle + button inside their own `max-w-*` column, so the app's top edge MOVED horizontally as you navigated: the Analytics title started at a different x than the Leads title. It is sticky because the title and the primary action are what you reach for after scrolling a long list, and making someone scroll back up to reach "+ New lead" is a tax that adds up over fifty leads a day (P7). Filters, the month picker and the cohort toggle moved into `#toolbar` — they decide what the figures below MEAN, so they should not scroll away from them. |
| B34 | **Card lists are a responsive grid, not a 768px centred column.** `grid gap-2 lg:grid-cols-2 2xl:grid-cols-3`, and the page wrapper dropped `max-w-3xl mx-auto`. | On a 1650px content area a `max-w-3xl` column left ~440px of dead space on each side and the content read as floating. Row-major flow keeps a ranked list readable as 1,2 / 3,4 — column-major would have broken the priority order. Forms keep their narrow caps (`max-w-md` on quick-add, `max-w-3xl` on Expenses and Users): a 1600px-wide text input is worse than dead space, not better. |
| B35 | **Full-bleed scroll containers pull through the ACTUAL gutter**: `-mx-4 sm:-mx-6 px-4 sm:px-6`. | The pull was hard-coded at 16px while the page gutter becomes 24px from 640px up, so the kanban board and both wide tables stopped 8px short of the edge — the kind of drift that makes a layout feel slightly off with nobody able to say why. |
| B28 | **Two disclosure mechanisms, chosen per screen, not one applied everywhere.** RANKED lists (work queue, urgency bands, kanban columns) cap at 10–12 rows and reveal with `ShowMoreButton`; BROWSED tables (CAC per staff, campaigns) use real `PaginationBar`. | Page 2 of a ranked list is by definition the least urgent work, and Previous/Next implies the user ought to go there. A browsed table is the opposite: a manager arrives wanting one specific person's row and needs an addressable position and a way back. A single pager over the six urgency bands would also have to slice ACROSS band boundaries, destroying the band as a unit of meaning. |
| B29 | **Every truncated list shows the TRUE total, never the visible count.** | "Overdue 10" when there are 37 hides work; a kanban column showing the value of 12 visible cards instead of all 30 misstates the pipeline; a campaign headline total that changes when you turn the page is not a total. |
| B30 | **The lead timeline pages at the QUERY, with a `limit + 1` sentinel.** | It was hard-capped at 50 activities with no way to see older ones — and P1 says the timeline IS the record, so silent truncation was the worst option available. Opening a lead now costs 21 reads instead of a flat 50; the extra document proves older history exists so the UI can say "Load older" or "Nothing older" truthfully. A `startAfter` cursor was rejected: `at` is a serverTimestamp and a batch writes two activities sharing one, so a value cursor can step over an entry. |
| B31 | **`usersPublic` is now actually populated by the seed, and `useUserNames` reads it.** | The rules defined the redacted mirror (B14) but nothing wrote to it, so the CAC-per-staff table printed raw uids at the manager it was written for. Reading `users` instead would have handed every viewer a colleague's commission rate — Firestore cannot project fields. |
| B32 | **The campaigns table is seeded from CAMPAIGNS, not from the leads that reference them.** | Building rows out of lead buckets silently dropped any campaign with zero attributed leads, from the table AND from "Total spend" — measured at TZS 320,000 of spend hidden on the seeded data. That is precisely the campaign a manager needs to see. A manager also gets a caption: they see org-wide SPEND but only their own team's LEADS, so every campaign would otherwise look worse than it is. |
| B27 | **Lists paginate client-side over the loaded set** (`usePagination`), 25/50/100 per page. | The query builders cap at 100–500 documents, which is the whole working set for one agent or team, so paging in the browser keeps search, filter chips and `priorityScore` sorting instant and avoids rebuilding a Firestore cursor on every filter change. The composable pulls the user back to the last real page when a filter shrinks the set — otherwise they sit on page 7 of a 2-page result, see nothing, and conclude there are no matches. Swap for cursor paging via the `after` option when a single view outgrows one query. |
| B25 | **A role that cannot read costs sees NO cost figures**, not zeroed ones. | A viewer may open Analytics but may not read `expenses` (§7.1). With no cost documents every cost-derived figure computes to **TZS 0** — which reads as "customers are free". Verified by execution, then hidden behind `can.viewCosts` with the reason stated on screen. |
| B23 | **Screens read through `src/composables/useCollection.js`, never a raw `onSnapshot`.** | §11.3: a leaked listener keeps billing after the user navigates away. Unsubscribe is enforced in the composable so no component can forget, real-time is opt-in rather than default, and snapshot metadata feeds the offline indicator. |
| B24 | **Client-side filtering and sorting on a bounded page**, not server-side. | Every extra `where()` needs its own composite index, and `priorityScore` decays with `daysToEvent` — a server `orderBy` on the stored value goes stale between nightly recomputes and quietly buries the leads that matter most. At 60–100 leads per agent the working set fits one query. Revisit when it does not. |
| B22 | **Every list query MUST constrain `orgId` plus its ownership field.** `src/services/queries.js` builds them; `tests/rules/list.rules.test.js` pins the matrix. | **Security rules are not filters.** On a `get` the rule sees the actual document; on a `list` it must be provable from the QUERY CONSTRAINTS before any document is read. So an agent querying `where('ownerId','==',me)` was **denied** — "Property orgId is undefined on object" — because the rule also reads `orgId`. Every list screen in Phase 2 (lead list, work queue, pipeline, urgency board) would have been dead on arrival. All 108 existing rules tests exercised `get` only, so none of them could see it. |
| B20 | **`tests/unit/i18n.test.js` pushes every message through the real vue-i18n compiler.** | A key-set diff passed while the app was broken: `auth.emailPlaceholder` was `jina@haflaway.com`, and `@` opens a linked-message reference in vue-i18n. Identical keys, identical spelling, and the login screen threw `Invalid linked format` at render. Keys matching is not the same as messages compiling. Mutation-tested: reintroducing the bare `@` fails four assertions. |
| B21 | **`scripts/free-ports.mjs` dropped `netstat -p TCP`.** | That flag filters to IPv4. Vite binds `localhost`, which resolves to `::1` on Windows, so an IPv6-only listener was invisible and the script reported "already free" while the port was held. The Firestore emulator hid it by binding 127.0.0.1. |
| B19 | **`npm run smoke` replaces ad-hoc curl checks.** Strict port, fresh process, probes index + entry + CSS + an SFC + a domain module, and asserts on the BODY. | A hand-rolled check reported "everything runs end to end" while the app was broken in the browser: it never fetched the CSS (where the failure was), and it started Vite without `--strictPort`, so it silently attached to an already-running stale server and measured a process it had not started. Vite serves its error overlay with HTTP 200, so a status code proves nothing. |
| B16 | **`scripts/check-bundle.mjs` gates the build.** It walks the transitive static import graph from the built entry, adds the boot chunks Vite declares in `__vite__mapDeps`, adds the login route, gzips the lot, and fails if Firestore appears or the total exceeds 250 KB. | Two separate ways of "measuring" the bundle were both wrong: reading `await import()` in the source, and reading the `modulepreload` hints in `index.html`. Only the built output tells the truth. |
| B17 | **`orgId` must match `^[a-z0-9-]{2,40}$`** — enforced in `scripts/syncClaims.js`. | It is the prefix of the `leadPhoneIndex/{orgId}_{phone}` key, and the rule authorises with `key.split('_')[0]`. An orgId like `haflaway_tz` splits to `haflaway`, leaking that org's phone claims to its prefix-neighbour *and* locking it out of its own. |
| B18 | **`firstContactedAt` is stamped by a transaction, not a client flag.** | The flag was optional, so omitting it was indistinguishable from "never contacted" — every later conversation reset the §8.6 response-time clock to now, making median first response permanently ~0. Same read-modify-write-on-a-client-value class as the counter bug, left behind in the same block. |
| B15 | **Every collection carries an org check**, and writes additionally carry `notClobberingAnotherOrg()`. | An adversarial rules audit found **28 cross-org breaches**: the money and control-plane collections were gated on ROLE ALONE, so a finance account in another org could read and rewrite this org's budgets, spend and cost policy. `inMyOrg()` alone was not enough either — document IDs are global, so a rival could overwrite `settings/org` just by stamping their own orgId on it. |
| B12 | **Unit tests, not just review, gate the domain layer.** Two adversarial critic passes found 13 defects in `periods`/`money`/`phone` and 15 in the UI shell; all are fixed with named regression tests in `tests/unit/regressions.test.js`. | Four were catastrophic and none was visible by reading: (1) a phone-normalisation bug that fabricated a real Mbeya landline out of junk input, colliding with the §6.4 dedupe key; (2) an auth-boot hang that showed a permanent spinner offline — P7/P8 broken for exactly the user the product exists for; (3) `changeStage` validated `closedAt`/`closedBy` **before** stamping them, so winning or losing a deal was literally impossible; (4) the 28 cross-org breaches in B15. Reviews found all four; the original tests found none of them, because the tests encoded the same assumptions as the code. |

### Review rounds so far

| Round | Focus | Found | Status |
|---|---|---|---|
| 1 | Domain logic (`periods`, `money`, `phone`) | 2 critical, 5 major, 6 minor | all fixed, regression-tested |
| 2 | UI shell, a11y, mobile, offline | 4 critical, 12 major, 10 minor | all fixed |
| 3 | Re-verify round 1 + attack new code | 2 critical, 2 high, 6 medium, 4 low | all fixed; 27 new rules tests |
| 4 | Verify rounds 1–3, attack scoring + services | 1 high, 3 medium, 4 low | all fixed |
| 5 | Verify round 2, attack the new shell | 3 critical, 5 major, 7 minor | all fixed |
| 6 | First live sign-in against the emulators | 1 critical (list vs get), 1 major (i18n `@`) | all fixed; 15 integration + 14 list-rules tests added |

**Round 4/5 verdicts on rounds 1–3:** every round-1 and round-3 fix confirmed dead by
re-execution — ~740k timezone property checks across six zones, 400k phone-injectivity
checks, a 1,000,000-input brute force on the fabricated-landline bug, and all 20 cross-org
attacks now denied. Three fixes were **not** what they claimed to be, and only executing
them showed it:

- **The lazy-Firestore split never worked.** The source `await import()` was correct, but a
  hand-written `advancedChunks` group hoisted `initializeApp` into the Firestore chunk, so
  the auth chunk imported it statically. Reading the source proved nothing; reading the
  `modulepreload` list in `index.html` was worse than nothing — it made a **266.8 KB**
  bundle look like 66 KB. `scripts/check-bundle.mjs` now walks the real graph and fails the
  build. Actual figure: **109 KB**.
- **The urgency floor never reached a stored score.** `recomputeScores()` and `createLead()`
  passed pre-computed components without `days`, so the floor was skipped on exactly the
  two paths that write the field the work queue sorts on. `priorityScore(leadDocument)`
  behaved correctly the whole time, which is what made it look fixed.
- **The offline indicator latched.** `reportSnapshot()` had zero call sites and `goOnline()`
  never cleared the Firestore flag, so after one signal drop the banner read "Huna mtandao"
  for the rest of the session — a permanent false negative, worse than the false positive
  it replaced.

**Still open** (cosmetic or scoped to a later phase, none blocking):
`--font-sans` names Inter with no `@font-face`, so it falls back to Roboto — fine for the
budget, but the token is a lie · no skip link · `usePermissions()` composable and `<Can>`
wrapper still unbuilt (`auth.can` covers today's needs) · `document.title` does not
re-render on a locale change until the next navigation · `createLead` and `changeStage`
write their `logActivity` entry outside the transaction that changed the lead, so a failure
there could leave a stage change with no timeline entry (P1) · **period keys are still
stamped from the client clock** (§6.1 wants them server-derived; the nightly recompute in
Phase 6 is the natural place, and a clock-skew warning at boot would tell us whether it is
real in the fleet before paying to backfill).

## 17. Open decisions  ← resolve these; each one blocks work downstream

| # | Question | Blocks | Recommendation |
|---|---|---|---|
| ~~D1~~ | ~~Upgrade to the Blaze plan?~~ Cloud Functions are needed for scheduled rollups, Meta webhooks and server-side claim sync. | Phases 6, 8 | **Yes, and PARTIALLY DONE**: `functions/` now exists, with `syncClaimsOnUserCreate` (server-side claim sync — see B44). Scheduled rollups and Meta webhooks are still open. Enabling Blaze billing on the `haflawaycrm` project itself is a Firebase-console step, outside any code change. |
| **D2** | Firestore region — **permanent, cannot be changed later**. | Phase 0 | ⚠️ The project already exists (`haflawaycrm`), so this may already be fixed. **Confirm the region in the Firebase console before there is production data**; moving later means an export/import migration. |
| **D3** | Do salaries count in CAC? | Phases 5, 6 | Yes for `CAC_staff`; offer a toggle for blended CAC (§9). |
| **D4** | Does commission count in CAC? | Phases 5, 6 | **No** — report separately as cost-of-sale (§9). |
| **D5** | Overhead allocation method | Phase 5 | `by_revenue` by default, admin-configurable per month. |
| **D6** | Default attribution model | Phase 2 | `first_touch`, with `touchpoints[]` stored so we can re-model later. |
| ~~D7~~ | ~~Sign-up model~~ | — | **RE-SETTLED**: self-service registration (`/register`) is now how someone joins — it mints their OWN new `orgId` and makes them its admin, so the original objection ("50 strangers sharing one lead pool") no longer applies: each registrant gets an isolated org, not a shared one. Admin-invite (Setup screen, `createTeamMember`/`adoptExistingUser`) remains how someone joins an EXISTING org. See B44. |
| **D8** | Can one lead have multiple events? | Phase 2 | No in v1 — a second event is a new lead linked to the same customer. Keeps the CAC math clean. |
| **D9** | On transfer, who gets credit for the win? | Phases 3, 6 | Closer gets the win; originator recorded in `previousOwnerIds`; report both. **Settle this before commissions launch.** |
| **D10** | SMS provider | Phase 8 | Compare Beem vs Africa's Talking on TZ price and delivery rate. |
| **D11** | Do we store guest lists in this system? | Phase 7 | Prefer **no** in v1 — large privacy surface (§7.3) for little CRM value. |

## 18. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Staff do not use it** — the number-one killer | Every metric becomes fiction | P7 speed budget · Swahili UI · pilot before rollout · manager rituals · make the Work Queue genuinely useful to the *agent*, not only to management |
| Manual ad-spend entry skipped or wrong | CAC is garbage | Meta API sync (Phase 8) · month-close checklist · flag campaigns that have leads but no spend |
| CAC-per-staff weaponised in performance reviews | Gaming, resentment, data manipulation | Low-confidence flags · visible `n=` · immutable ledger · publish the methodology page (§9) |
| Duplicate leads → commission disputes | Trust collapses | Phone lock (§6.4) built in Phase 2, not later |
| Firestore read costs balloon | Budget surprise | §11.3 discipline · rollups · dev read counter |
| Offline sync conflicts | Lost notes | Append-only activities (P1) make merges safe by construction |
| Scope creep into "generic CRM" | Never ships | P12 · this document is the scope · new ideas go to Phase 11 |
| Attribution disputes between channels | Endless meetings | Model frozen per month (§9) · caption on every chart (P5) |

---

## 19. First week — concrete starting order

1. Finish **Phase 0** end to end. Do not start features until the emulator suite runs.
2. `src/domain/phone.js`, `periods.js`, `money.js` with tests. Boring, load-bearing, fast.
3. `firestore.rules` v1 plus rules tests for `users` and `leads`.
4. Auth, router guards, app shell.
5. `createLead()` with the transactional phone lock, and the quick-add form.
   **Time yourself: 20 seconds.**
6. The lead timeline with one-tap activity logging.
7. Then — and only then — the Work Queue (Phase 4), where the business value actually lands.

> **If you remember only one sentence:**
> *Every feature must either capture a lead faster, cause a follow-up that would otherwise not have
> happened, or make a shilling traceable. If it does none of those three, it belongs in Phase 11.*
