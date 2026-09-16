# Haflaway CRM — Lean Rebuild Plan

> **Read this first.** This supersedes `TODO.legacy.md`, which planned a much bigger CAC /
> ad-spend / campaign-attribution system. That plan is archived, not deleted — some of its
> reasoning (esp. security-rules lessons) is cited below where it still applies. This document
> is scoped to exactly what the owner described: a lead follow-up tracker for a card/invitation
> business, with a rep-facing work queue and an owner-facing operations dashboard.
>
> Any agent should be able to open this file, find the first unchecked box, and keep going
> without asking questions. Update checkboxes in the same commit as the work.

| | |
|---|---|
| **Product** | Lead-to-close tracker for Haflaway — a business selling event-related printed/digital products (committee invites, contribution reminders, contribution cards, event invitations) |
| **Stack** | Vue 3 `<script setup>` + Vite · Pinia · Vue Router 4 · Firebase Auth + Firestore · vue-i18n (en/sw) · Tailwind |
| **Status** | Views and shell were wiped clean (see git log). Auth/org/user plumbing and `firebase.rules` for those collections are intact and reused as-is. Everything under "the leads model" is being rebuilt per this document. |
| **Reused from the legacy plan** | `src/domain/phone.js`, `src/domain/periods.js`, `src/domain/org.js`, `src/firebase/app.js`, `src/stores/auth.js`, `src/stores/ui.js`, the `orgs`/`users`/`usersPublic`/`teams` collections and their rules, `composables/useCollection.js`, `useNow.js`, `usePagination.js`, `useUserNames.js` |
| **Dropped from the legacy plan** | Ad spend, campaigns, expenses, cost allocation, CAC, rollups, qualification scoring (BEDS), the generic pipeline state machine, quotes, customers/projects, multi-role finance/viewer distinctions — none of this was in the owner's brief. Revisit only if asked for. |

---

## 0. How to use this document

- Work top-to-bottom by phase. `- [ ]` not started · `- [x]` done · `- [~] @who` in progress.
- §1–§4 are the contract (business rules + data model). Do not change them silently — if
  something here turns out to be wrong once building starts, stop and flag it back to the user
  rather than guessing a fix.
- §5 onward is the build queue.

---

## 1. The business, in one paragraph

Haflaway gets leads from Facebook/Instagram/WhatsApp ads, committee-meeting visits, and
referrals. Sales reps call/message leads to convert them, which can take anywhere from a day to
weeks of periodic follow-up. **Every contact must end with either a scheduled next follow-up
(any distance in the future, even minutes) or a closing outcome.** A lead isn't one flat deal —
over time it can buy several distinct products for the same event (committee invite cards,
contribution reminders, contribution cards, the actual event invitation cards), and each product
is tracked and closed independently: a lead can be "closed" for reminders while still open for
the invitation cards. Reps start their day on a queue of who's due for follow-up. The owner wants
a daily/weekly/monthly/quarterly view of volume (leads captured, contacts made) and outcomes
(conversions broken down by product).

## 2. Glossary

| Term | Meaning |
|---|---|
| **Lead** | A prospect/client. Owns a phone/name, an optional event, and a set of activities and deals. |
| **Deal** | One product engagement on a lead — e.g. "contribution reminders for this lead's event." Has its own status. A lead can have zero, one, or several. |
| **Product type** | `committee_invite` (Kadi za Mwaliko wa Kamati) · `contribution_reminder` (Reminder za Michango) · `contribution_card` (Kadi za Michango) · `invitation_card` (Kadi za Mwaliko/event invitation) · `other` |
| **Activity** | An immutable log entry of one contact attempt: channel, what was discussed/concluded, and (unless it closes something) a required next follow-up time. |
| **Follow-up / next action** | `nextFollowUpAt` on the lead — fully dynamic, set by whatever the rep and client agreed, no fixed cadence. This is what "urgent" means in this product — **not** the event date. |
| **Work Queue** | A rep's home screen: leads whose `nextFollowUpAt` is overdue, due today, or coming up. |
| **Closed-won (per deal)** | That product is sold/agreed for this lead. |
| **Closed-lost (per deal)** | That product will not happen for this lead; a reason is required. |
| **Hot lead** | A rep/manager-set flag surfacing a lead as especially promising on the dashboard. |

**Swahili UI mapping** (§8): Lead → *Mteja tarajiwa* · Follow-up → *Kufuatilia* · Won → *Imefanikiwa* · Lost → *Imepotea* · Event → *Tukio*.

## 3. Firestore data model

Builds on the **unchanged** `orgs/{orgId}`, `users/{uid}`, `usersPublic/{uid}`, `teams/{teamId}`
collections and rules already in the repo. Roles simplify to `admin | manager | agent` (drop
`finance`/`viewer` — they existed only to gate cost visibility, which no longer exists).

```
leads/{leadId}
  orgId, ownerId, previousOwnerIds[], teamId          // reassignable by manager/admin
  displayName, primaryPhone, primaryPhoneNormalized, altPhones[], email
  source                    // 'facebook' | 'instagram' | 'whatsapp' | 'committee_visit' | 'referral' | 'walk_in' | 'other'
  referredBy                // free text, optional
  eventType, eventDate, eventDateIsFirm     // optional — not every lead has a known event yet
  nextFollowUpAt            // REQUIRED while the lead has any open deal or no deals yet — drives the queue
  nextFollowUpType          // free label, e.g. "call back", optional
  firstContactedAt, lastContactedAt, lastActivityAt
  isHot                      // manual flag, boolean
  dayKey, weekKey, monthKey, quarterKey     // of createdAt — see domain/periods.js
  createdAt, createdBy, updatedAt, updatedBy, deletedAt

leads/{leadId}/deals/{dealId}
  orgId                      // denormalised — see the B22 note below, still applies
  productType                // see §2
  status                     // 'open' | 'closed_won' | 'closed_lost'
  closedAt, closedBy, lostReason      // lostReason required when status = 'closed_lost'
  closedDayKey, closedWeekKey, closedMonthKey, closedQuarterKey    // stamped when closed, for dashboard grouping
  createdAt, createdBy, updatedAt, updatedBy

leads/{leadId}/activities/{activityId}       # APPEND-ONLY
  orgId                      // denormalised, same reason as deals
  channel                    // 'call' | 'whatsapp' | 'sms' | 'in_person' | 'other'
  outcome                    // 'spoke' | 'no_answer' | 'busy' | 'switched_off' | 'wrong_number' | 'callback_requested'
  summary                    // free text: what was discussed / agreed
  dealId                     // optional — links this contact to one product deal; null = general
  byUserId, byUserName, at
  nextFollowUpAt             // REQUIRED unless this activity records a closing outcome
  dayKey, weekKey, monthKey, quarterKey      // of `at`, for the dashboard's contact-volume counts
  isVoided, voidedBy, voidReason, voidedAt

leadPhoneIndex/{orgId}_{phoneNormalized}     // KEPT from the legacy plan — cheap, prevents 3 reps
  leadId, ownerId, orgId, createdAt          // calling the same bride from 3 different numbers
```

**Why `orgId` is denormalised onto `deals` and `activities`.** The legacy plan's B22 lesson still
applies: a Firestore security rule can only see a document's own fields on a `list` (collection
group query) — it cannot reach up to a parent to check `orgId` the way a single-document `get`
can. Any dashboard query that fans out across leads (e.g. "every deal closed this week, all
reps") has to be a `collectionGroup` query filtered by `orgId`, so `orgId` must live on the child
document itself.

**Why no `leadStatus` field on the lead.** A lead isn't itself open/closed — its *deals* are. The
work queue and dashboards derive "does this lead need a follow-up" from `nextFollowUpAt` being
set and in the past/present, not from a status enum. A lead with zero deals is still followable
(that's the normal state before anything's been sold).

## 4. Security rules — what must hold

Extends the existing `firestore.rules` (identity/org helpers, `users`, `usersPublic`, `teams`,
`leadPhoneIndex` blocks stay as-is; drop the `campaigns`/`expenses`/`costAllocationPolicy`/
`customers`/`projects`/`products`/`rollups`/`notifications`/`auditLogs`/`importJobs`/
`leadDeletions` blocks — nothing in this plan writes those collections). New/changed:

- [ ] `leads`: read/write scoped by `ownerId` (own), `teamId` (manager, own team), or `isAdmin()`
      — same ownership pattern as the legacy rules, just without the stage-transition machinery.
- [ ] `leads/{id}/deals/{dealId}`: `create`/`update` require `canWriteLeadById(leadId)`.
      Closing (`status` → `closed_won`/`closed_lost`) requires `closedAt == request.time`,
      `closedBy == uid()`, and — for `closed_lost` — a non-empty `lostReason`. No `delete`.
- [ ] `leads/{id}/activities/{activityId}`: append-only, same pattern as the legacy plan
      (`create` allowed, `update` only to set `isVoided` + reason, never `delete` except the
      admin cascade on lead delete). **`nextFollowUpAt` must be present on create UNLESS the
      activity's `outcome` is closing something** — enforce in the client form (required field)
      and accept either presence in rules; a hard block requires reasoning about which activities
      "close" something, which the deal write already gates, so don't over-engineer this in rules.
- [ ] `leadPhoneIndex`: unchanged from the legacy rules.
- [ ] Every collection group query (deals, activities used cross-lead for the dashboard) is
      constrained by `orgId` **in the query itself** — provable from query constraints, not from
      reading each document. Write a rules test for this exact case; it's the one the legacy
      plan's B22 note says is easy to get wrong.
- [ ] `ownerId` reassignment on a lead: manager/admin only (unchanged pattern).
- [ ] Roles: `admin | manager | agent` only — remove `finance`/`viewer` branches that no longer
      apply (`canReadAllLeads`, campaign/expense-specific rules, etc).

## 5. Screens to build

| # | Screen | Who | Notes |
|---|---|---|---|
| 1 | Login / Register / Forgot password / No-access | all | Reuse existing auth store; rebuild the view files (deleted this session) |
| 2 | **Work Queue** (home) | rep | Overdue / Today / Coming up, sorted by `nextFollowUpAt`. One-tap Call/WhatsApp/Log. This is the most important screen. |
| 3 | Lead list | rep, manager | Search by name/phone, filter by owner/source/follow-up bucket |
| 4 | **Lead detail** | rep | Header (name, phone, event) · one card per deal (status, close/reopen, lost reason) · "add a product" · activity timeline · log-activity form (channel, outcome, summary, mandatory next-follow-up unless closing) · reassign owner |
| 5 | Quick-add lead | rep | Phone first, inline duplicate check via `leadPhoneIndex`, everything else optional |
| 6 | **Owner dashboard** | owner/admin, manager | Period toggle (day/week/month/quarter): leads captured, contacts made, deals closed-won broken down by product type, upcoming events, hot/most-promising leads, lost-reason breakdown |
| 7 | Settings (profile, password, locale) | all | Reuse `stores/auth.js` — mostly already there |
| 8 | Admin — users | admin | Reuse existing user-management pattern, drop role options down to admin/manager/agent |
| 9 | Setup (first-admin bootstrap) | admin | Reuse existing `registerOrganization()` flow as-is |
| 10 | Forbidden / Not found | all | Small, reuse existing copy pattern |

## 6. Non-functional requirements (kept from the legacy plan — still true)

- New lead entry ≤20 seconds on a mid-range Android phone.
- Logging an interaction ≤3 taps, and the next-follow-up picker must be one tap for the common
  cases (quick chips: 2h · tomorrow 9am · 3 days · 1 week · custom).
- Works offline (Firestore persistent cache) — every write optimistic, no spinners blocking a save.
- Mobile-first layout, verified at 360px width.
- Swahili and English strings both present for every new key.

## 7. Definition of done (per task)

- [ ] `firestore.rules` updated and covered by a rules test, if the task touches data access.
- [ ] Composite indexes added to `firestore.indexes.json` if a new query needs one.
- [ ] Pure logic in `src/domain/`, unit-tested.
- [ ] Mobile layout checked at 360px.
- [ ] Swahili + English strings present.
- [ ] `npm run build` and `npx vitest run` both pass.

---

# BUILD QUEUE

## Phase 0 — Clear the decks

- [x] Archive the legacy plan (`TODO.md` → `TODO.legacy.md`); write this document.
- [ ] Remove domain modules tied to the dropped model: `src/domain/stages.js`,
      `src/domain/scoring.js`, `src/domain/metrics.js`, `src/domain/money.js` (git rm — recoverable
      from history if a later phase genuinely needs deal-value arithmetic).
- [ ] Rewrite `src/domain/taxonomies.js`: `PRODUCT_TYPES`, `LEAD_SOURCES`, `CHANNELS`,
      `CALL_OUTCOMES` (keep — still useful), `DEAL_STATUS`, `LOST_REASONS`. Drop `BUDGET_BANDS`.
- [ ] Remove `src/composables/useStageMessage.js` (tied to the dropped pipeline state machine).
- [ ] Remove tests tied to dropped modules: `tests/unit/stages.test.js`, `scoring.test.js`,
      `metrics.test.js`, `money.test.js`, `tests/rules/leads.rules.test.js` (rewrite fresh instead),
      `tests/rules/crossorg.rules.test.js` (rewrite fresh), `tests/rules/delete.rules.test.js`
      (rewrite fresh), `tests/rules/list.rules.test.js` (rewrite fresh),
      `tests/integration/campaigns.integration.test.js`,
      `tests/integration/finance-integrity.integration.test.js`,
      `tests/integration/campaign-attribution.integration.test.js`,
      `tests/integration/analytics.integration.test.js`,
      `tests/integration/leads.integration.test.js` (rewrite fresh),
      `tests/integration/queries.integration.test.js` (rewrite fresh),
      `tests/unit/delete-lead.test.js` (rewrite fresh), `tests/unit/void-activity.test.js`
      (rewrite fresh against the new schema), all of `tests/views/*` (the views they mount are
      gone — rewrite once the new views exist).
- [ ] Simplify `ROLES` in `src/stores/auth.js` to `['admin', 'manager', 'agent']`; update the
      `can` computed (drop `viewCosts`/`editCosts`/`lockMonth`); update `role.*` i18n keys.

## Phase 1 — Domain & rules foundation

- [ ] `src/domain/followUp.js`: pure functions for queue bucketing (overdue/today/upcoming from
      `nextFollowUpAt` + "now"), quick-chip offset resolution (2h/tomorrow 9am/3 days/1 week),
      and display formatting ("2 days overdue", "in 3h"). Unit-tested.
  - [x] Reused as-is: `src/domain/phone.js`, `src/domain/periods.js`, `src/domain/org.js`.
- [ ] Rewrite `firestore.rules` per §4. Delete the dropped collections' match blocks.
- [ ] Rewrite `firestore.indexes.json`: `leads` (ownerId+nextFollowUpAt, teamId+nextFollowUpAt,
      orgId+monthKey), `deals` collection-group (orgId+status+closedMonthKey, orgId+productType+
      status), `activities` collection-group (orgId+monthKey, byUserId+at).
- [ ] Rules tests: `tests/rules/leads.rules.test.js` (ownership, reassignment, team scoping),
      `tests/rules/deals.rules.test.js` (closing requires reason/timestamp/actor), `tests/rules/
      activities.rules.test.js` (append-only, void-only update), `tests/rules/collectiongroup.rules.test.js`
      (the B22-style cross-org leak check for the dashboard's collection-group queries).

## Phase 2 — Services & stores

- [ ] `src/services/leads.service.js`: rewrite `createLead()` (keeps the transactional phone-lock
      pattern), `updateLead()`, `reassignLead()`.
- [ ] `src/services/deals.service.js`: `addDeal()`, `closeDeal(status, {lostReason})`, `reopenDeal()`.
- [ ] `src/services/activities.service.js`: `logActivity()` — writes the activity and updates the
      parent lead's `nextFollowUpAt`/`lastContactedAt`/`lastActivityAt` in one transaction.
- [ ] `src/services/queries.js`: rewrite query builders for the work queue, lead list, and
      dashboard aggregations (collection-group reads over `deals`/`activities`, always
      `orgId`-constrained per §4).
- [ ] `src/stores/leads.js`: wraps the above for the UI (current lead, list, mutations).
- [ ] `src/stores/dashboard.js`: period-scoped aggregate counts (see §5 screen 6) computed via
      live Firestore queries — no rollups needed at this scale; revisit only if it's ever slow.

## Phase 3 — App shell

- [ ] Rebuild `src/components/layout/AppLayout.vue` and `AuthLayout.vue` (nav: Work Queue,
      Leads, Dashboard, Settings, Admin/Users for admins).
- [ ] Rebuild `src/components/ui/ToastHost.vue`, `OfflineBanner.vue`, `LocaleToggle.vue`.
- [ ] Restore `App.vue` to use the layouts again (currently a bare `RouterView`).
- [ ] Wire `src/router/index.js` routes back for every screen in §5, with the same
      `requiresAuth`/`roles`/`allowUnprovisioned` guard pattern already in the router file.

## Phase 4 — Screens

- [ ] Auth screens: Login, Register, ForgotPassword, NoAccess (mostly porting existing copy/logic
      onto the current `stores/auth.js`, which is unchanged).
- [ ] Quick-add lead (screen 5).
- [ ] Work Queue (screen 2) — the priority screen.
- [ ] Lead list (screen 3).
- [ ] Lead detail (screen 4): deal cards, add-a-product, log-activity dialog with mandatory
      follow-up picker, close/reopen deal with lost-reason capture, reassign.
- [ ] Owner dashboard (screen 6): period toggle, the metrics named in §1/§5, drill-down from each
      number to the underlying lead list where practical.
- [ ] Settings, Admin/Users, Setup, Forbidden, NotFound (screens 7–10).

## Phase 5 — i18n

- [ ] `src/locales/en.json` / `sw.json`: keys for every new screen and taxonomy value
      (`productType.*`, `lostReason.*`, `dealStatus.*`, `source.*`, `activity.*`, `queue.*`,
      `dashboard.*`). Run `tests/unit/i18n.test.js`-style compile check (rewrite if needed — the
      mechanism, not the content, is reusable).

## Phase 6 — Tests & hardening

- [ ] `tests/views/mount.test.js`-equivalent: mount every rebuilt view with/without data.
- [ ] Rules test suite green end-to-end (`npm run test:rules`).
- [ ] `npm run build` passes the bundle-size gate.
- [ ] Manual pass: create a lead, add two different product deals, log activities with mandatory
      follow-ups, close one deal won with a reason skipped (should be blocked), close one lost
      with a reason, verify the dashboard counts update, verify offline (airplane mode) queues
      writes and syncs on reconnect.

---

## 8. Localisation

Swahili-first UI (field staff), English available. Reuse `Africa/Dar_es_Salaam` timezone handling
from `periods.js`. Event vocabulary: *Harusi*, *Send-off*, *Kitchen party*, *Mahafali*,
*Kumbukumbu*, *Corporate*, *Other* (unchanged from the legacy plan — still accurate).

## 9. Open questions

None blocking right now — the owner answered the load-bearing ones in conversation (§1). If a new
ambiguity turns up while building, add it here with the question, what it blocks, and a
recommendation, rather than guessing silently.
