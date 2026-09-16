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
  lastActivitySummary, lastActivityChannel, lastActivityOutcome, lastActivityId
                             // denormalised head of the timeline (added during Phase 2) — a
                             // list row shows "what happened last" without reading the
                             // activities subcollection per row
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
- [x] Remove domain modules tied to the dropped model: `src/domain/stages.js`,
      `src/domain/scoring.js`, `src/domain/metrics.js`, `src/domain/money.js` (git rm — recoverable
      from history if a later phase genuinely needs deal-value arithmetic).
- [x] Rewrite `src/domain/taxonomies.js`: `PRODUCT_TYPES`, `LEAD_SOURCES`, `CHANNELS`,
      `CALL_OUTCOMES` (keep — still useful), `DEAL_STATUSES`, `LOST_REASONS`. Drop `BUDGET_BANDS`.
- [x] Remove `src/composables/useStageMessage.js` (tied to the dropped pipeline state machine).
- [x] Remove tests tied to dropped modules: `tests/unit/stages.test.js`, `scoring.test.js`,
      `metrics.test.js`, `money.test.js`, `tests/rules/leads.rules.test.js`,
      `tests/rules/crossorg.rules.test.js`, `tests/rules/delete.rules.test.js`,
      `tests/rules/list.rules.test.js`,
      `tests/integration/campaigns.integration.test.js`,
      `tests/integration/finance-integrity.integration.test.js`,
      `tests/integration/campaign-attribution.integration.test.js`,
      `tests/integration/analytics.integration.test.js`,
      `tests/integration/leads.integration.test.js`,
      `tests/integration/queries.integration.test.js`,
      `tests/unit/delete-lead.test.js`, `tests/unit/void-activity.test.js`,
      all of `tests/views/*` (the views they mount are gone). Trimmed the now-dead
      money-specific `describe` blocks out of `tests/unit/regressions.test.js` (its
      periods/phone regression cases stay — those modules are kept). `npx vitest run`:
      9 files, 142 tests, all green. To rewrite fresh once the matching new code exists:
      leads/deals/activities rules tests, leads/queries integration tests. (Rules and
      integration tests need a running emulator — deferred to Phase 1/6, not run this session.)
- [x] Simplify `ROLES` in `src/stores/auth.js` to `['admin', 'manager', 'agent']`; update the
      `can` computed (drop `viewCosts`/`editCosts`/`lockMonth`/`viewAuditLog`, `viewAllLeads`
      now admin-only since there's no viewer role). `role.*` i18n keys still need pruning —
      folded into Phase 5 (i18n) rather than done twice.

## Phase 1 — Domain & rules foundation

- [x] `src/domain/followUp.js`: pure functions for queue bucketing (overdue/today/upcoming from
      `nextFollowUpAt` + "now"), quick-chip offset resolution (2h/tomorrow9am/3d/1w), and
      display description (`describeFollowUp` → i18n key + count) and queue sorting
      (`sortByFollowUp`). Unit-tested (`tests/unit/followUp.test.js`).
  - [x] Added `quarterKey()` to `src/domain/periods.js` (the dashboard's period toggle needs
        day/week/month/quarter; only the first three existed). Updated its tests.
  - [x] Reused as-is: `src/domain/phone.js`, `src/domain/org.js`.
- [x] Rewrote `firestore.rules` per §4. Dropped the CAC-era collections' match blocks
      (campaigns, expenses, costAllocationPolicy, customers, projects, products, quotes,
      rollups, notifications, settings, auditLogs, importJobs, leadDeletions) — nothing in
      this plan writes them. Kept orgs/users/usersPublic/teams/leadPhoneIndex unchanged.
      **Found and fixed a real bug via the emulator, not by reading**: combining
      `canReadLeadById(leadId)` (a parent `get()`) with `canReadOrgWide(resource.data)` in one
      `allow list` broke the dashboard's collection-group query entirely — Firestore's list
      provability check rejects the whole boolean expression once a get() with a
      per-document-variable path appears anywhere in it, even behind `||`. Fixed by splitting
      into two separate top-level `match` blocks (Firestore ORs every block that matches a
      document); see the comment on `canReadOrgWide()` in firestore.rules.
- [x] Rewrote `firestore.indexes.json`: leads (ownerId/teamId+nextFollowUpAt, ownerId+updatedAt,
      dayKey/weekKey/monthKey/quarterKey, eventDate), deals collection-group
      (orgId+status+closedDayKey/Week/Month/QuarterKey), activities collection-group
      (orgId+dayKey/weekKey/monthKey/quarterKey, isVoided+at).
- [x] Rules tests written AND run against the real Firestore emulator (`npm run test:rules` —
      Java + firebase-tools are available in this environment): `tests/rules/leads.rules.test.js`,
      `tests/rules/deals.rules.test.js`, `tests/rules/activities.rules.test.js`,
      `tests/rules/collectiongroup.rules.test.js` (the org-scoping check for the dashboard's
      collection-group queries — this is what caught the bug above). Also repaired
      `tests/rules/orgs.rules.test.js`, which still worked structurally but exercised the
      now-dropped `expenses`/`settings` collections as stand-in test fixtures; swapped those
      for `leads`, and deleted the one test that specifically asserted `settings/bootstrap`
      behaviour (that collection no longer exists). **93 rules tests, 5 files, all green.**
  - [ ] `tests/integration/auth.integration.test.js` had the same staleness (finance/viewer
        accounts, expenses/campaigns reads) — trimmed to match the new role set, but NOT run
        this session: it needs `scripts/seed.js` rewritten for the new lead/deal/activity
        schema first (still seeds the old stage/attribution shape). Rewriting `seed.js` is
        folded into Phase 2 (services), since it should be written against the same
        `leads.service.js`/`deals.service.js` the app uses, not duplicate the shape by hand.

## Phase 2 — Services & stores

- [x] `src/services/leads.service.js`: rewritten — `createLead()` (keeps the transactional
      phone-lock pattern; defaults `nextFollowUpAt` to now so a brand-new lead is immediately
      queued for a first touch), `updateLead()`, `reassignLead()`, `deleteLead()` (admin hard
      delete cascade, simplified from the legacy version — no `leadDeletions` tombstone, since
      that collection was deliberately dropped from firestore.rules in Phase 1).
- [x] `src/services/deals.service.js`: `addDeal()` (refuses a second simultaneously-open deal
      of the same product on one lead), `closeDeal(status, {lostReason})` (stamps
      `closed*Key` period fields for the dashboard), `reopenDeal()`.
- [x] `src/services/activities.service.js`: `logActivity()` — a transaction (not just a batch,
      unlike the legacy version) writing the activity and updating the parent lead's
      `nextFollowUpAt`/`lastContactedAt`/`lastActivityAt` plus a denormalised "last contact"
      preview (`lastActivitySummary/Channel/Outcome/Id` — added to the §3 lead schema; not in
      the original sketch, needed so a list row can show "what happened last" without a
      subcollection read per row). `voidActivity()`, `setNextFollowUp()`.
- [x] `src/services/queries.js`: rewritten query builders — `workQueueQuery`, `leadListQuery`,
      `upcomingEventsQuery`, `hotLeadsQuery`, `leadsCreatedInPeriodQuery`,
      `dealsClosedInPeriodQuery`/`activitiesInPeriodQuery` (collection-group, `orgId`-constrained
      per §4 — throws a clear error for a role that can't prove access, rather than letting an
      opaque Firebase permission error reach the UI).
- [x] `src/stores/leads.js`: wraps the above for the UI (work queue, lead list, current lead,
      deals, timeline, all mutations) via the existing `useCollection`/`useDoc` composables.
- [x] `src/stores/dashboard.js`: period-scoped aggregate counts (§5 screen 6) via one-shot
      `Promise.all` queries, re-run on period switch — no rollups needed at this scale.
- [x] `scripts/seed.js` rewritten for the new schema (leads/deals/activities, no more
      campaigns/expenses/products/tasks/cost policy). Syntax-checked and re-verified against
      the real Firestore emulator (rules tests still 93/93 green after the rewrite), but NOT
      actually run end-to-end this session: it needs the Auth emulator too, and that
      environment's Auth emulator binary isn't cached/downloadable in this sandbox (network-
      restricted) — the Firestore emulator's jar was already cached from Phase 1's runs, Auth's
      was not. **Run `npm run dev:emulators` then `npm run seed` in a normal dev environment
      before trusting this script fully; also re-verify `tests/integration/auth.integration.test.js`
      there** — it depends on exactly the accounts/leads this script creates.
- [x] `src/services/provisioning.service.js`'s `ASSIGNABLE_ROLES` simplified to
      `['admin','manager','agent']` (was carrying the dropped finance/viewer roles).

## Phase 3 — App shell

- [x] Rebuilt `src/components/layout/AppLayout.vue` (responsive: sticky sidebar ≥640px,
      fixed bottom tab bar on mobile — nav: Work Queue, Leads, Dashboard, Users for admins,
      Settings) and `AuthLayout.vue` (centred card).
- [x] Rebuilt `src/components/ui/ToastHost.vue`, `OfflineBanner.vue`, `LocaleToggle.vue` — all
      thin wrappers around the UNCHANGED `stores/ui.js`/`i18n.js`, so no new state design was
      needed here.
- [x] Restored `App.vue` to use the layouts again.
- [x] Pruned/refreshed the `nav.*` locale keys (dropped campaigns/expenses/analytics/
      pipeline/urgency/months, added dashboard) in both `en.json` and `sw.json` — just this
      one namespace, so the shell itself has correct labels. The rest of §5's Phase 5 (i18n)
      is still open.
- [x] Router wiring — deliberately left for Phase 4 at the time this was written (see the
      reasoning below, still accurate); completed there. `src/router/index.js` now has all 14
      routes; confirmed done reading Phase 4's own notes and the file itself.
      *(Original note, kept for the reasoning: a route pointing at a view file that doesn't
      exist yet fails `vite build` outright — dynamic import specifiers are resolved
      statically — so each route had to be added in the same step as the view file it
      points to, not ahead of it.)*
- Build (`npx vite build`) and full unit suite (164 tests) verified green with the shell
  wired but zero routes — confirms App.vue/layouts don't themselves break anything before a
  single screen exists.

## Phase 4 — Screens

- [x] Auth screens: Login, Register, ForgotPassword, NoAccess. Register is self-service:
      `registerAccount()` then `registerOrganization()` in one flow, with a distinct retryable
      "org step failed" state. `registerAccount()` only reports success/failure, not the
      credential, so RegisterView polls `auth.uid` briefly rather than changing the store's
      contract — the store's own `onAuthStateChanged` listener is what populates it, and that
      fires asynchronously relative to the create-user promise settling.
- [x] Quick-add lead (screen 5). Phone-first, debounced inline duplicate check via
      `checkPhoneAvailable()`, name/source/event-type/hot all optional.
- [x] Work Queue (screen 2) — the priority screen. Overdue/today/upcoming via
      `domain/followUp.js`, re-bucketed reactively off `useNow()`. One-tap call/WhatsApp/log/
      snooze per row.
- [x] Lead list (screen 3). Search (name/phone) + filter by follow-up bucket/source/owner
      (owner filter manager/admin only — an agent's query is already scoped server-side).
      Card-list layout (not `.data-table`) for consistency with Work Queue at the 360px floor.
- [x] Lead detail (screen 4): deal cards (status badge, mark won via a native `confirm()`, mark
      lost via a required-reason dialog, reopen gated manager/admin in the UI to match
      firestore.rules), add-a-product (only product types with no open deal), activity timeline
      with load-more and a void/retract flow (reason required, entry stays struck-through),
      log-activity dialog with mandatory next-follow-up, reassign (manager/admin only).
      **Deferred**: no "delete lead" UI — `deleteLead()` and its locale keys are ready, but the
      screen-4 bullet list above never asked for it, and it is the one irreversible action in
      the product. Left as an explicit gap rather than wiring it under time pressure.
      **Real bug found & fixed while building this**: Vue Router reuses a component instance
      across a param-only navigation on the same route record, so a lead-A → lead-B in-app link
      (e.g. quick-add's "open existing lead") would NOT remount LeadDetailView, leaving its
      Firestore listeners pointed at the old lead id. Fixed in `App.vue` by keying the routed
      component on `route.fullPath` — app-wide, not scoped to this one screen.
- [x] Owner dashboard (screen 6): period toggle, leads captured, contacts made, closed-won by
      product (+ total), lost by reason, upcoming events (30-day window), hot leads — every row
      links into Lead Detail. `meta.roles: ['admin','manager']`.
- [x] Settings (profile name — writes both `users/{uid}` and its `usersPublic/{uid}` mirror,
      language toggle, change password), Admin/Users (role + active/inactive, self-edit
      disabled, links to Setup rather than duplicating its form), Setup (two-stage: org
      bootstrap via `registerOrganization()` when the caller has no org yet, then add-a-
      colleague via `createTeamMember()`/`adoptExistingUser()` with a create/adopt mode
      toggle), Forbidden, NotFound (screens 7–10) — all done.
- [x] Every route wired in `src/router/index.js` in the same step as its view file, per the
      Phase 3 note. `npx vite build` and `npx vitest run` (164 tests) green after every chunk.
      `npm run build`'s bundle-size gate passes with 137.7 KB of headroom on the login path.

## Phase 5 — i18n

- [x] `src/locales/en.json` / `sw.json`: added `productType.*`, `dealStatus.*`, `channel.*`
      (token-for-token against `domain/taxonomies.js`), `dashboard.*`, `leadDetail.*`, plus
      `source.committee_visit` (the old file had a stale `field` key — taxonomies.js uses
      `committee_visit`) and a handful of small additions (`quickAdd.phonePlaceholder`,
      `quickAdd.hot`, `auth.register.displayName`, `auth.noAccess.setupLink`). Reused as-is
      where the legacy text already fit: `queue.*`, `activity.*`, `snooze.*`, `lossReason.*`
      and `eventType.*` (exact token matches), `nextAction.*` (exact match to
      `describeFollowUp()`'s keys — dropped the unused `nextAction.tomorrow`, which that
      function never actually emits), `deleteLead.*` (trimmed of quotes/CAC subkeys),
      `detail.*` (trimmed to the generic timeline/void keys Lead Detail's activity log reuses).
      Pruned the now-fully-dead CAC/pipeline namespaces: `campaigns`, `expenses`,
      `expenseCategory`, `allocation`, `analytics`, `funnel`, `metrics`, `overheadMethod`,
      `attributionModel`, `months`, `pipeline`, `stageMove`, `fieldName`, `parkReason`,
      `urgency`, `activityType`, `budgetBand`, `stage`, `lastContact`, `list`, `pagination`,
      plus the `role.finance`/`role.viewer` labels for the roles Phase 0 already dropped from
      `ROLES`. `tests/unit/i18n.test.js` (compile-through-vue-i18n, key-set parity,
      interpolation-param parity) needed no rewrite — it is data-driven off the two JSON files
      — and passes with every key above.

## Phase 6 — Tests & hardening

- [x] `tests/views/mount.test.js`: mounts all 14 views (17 cases — a couple get a second role
      variant) against a shared Firestore/Auth mock (`tests/views/setupFirebaseMock.js`) and a
      real signed-in Pinia auth store, asserting no render-time `console.error` and non-empty
      output. **Scope, stated honestly**: this is the "empty state" pass only — the mock's
      `onSnapshot`/`getDocs` return an empty snapshot regardless of which query was built, so
      it does not exercise how a screen renders WITH rows (LeadDetailView's lead+deals+
      timeline are three separate live subscriptions in one mount; routing distinct canned
      data to each would need a query-aware mock, which is real additional engineering this
      pass didn't do). **Mutation-verified**: deliberately broke WorkQueueView's template
      (`items.thisFieldDoesNotExist.length`), confirmed the suite fails with the exact
      TypeError, then reverted and confirmed green again — so this is proven to catch a real
      render-time throw, not just passing trivially.
      `npm run test:views` runs it; `npm run test:all` already wired it in (pre-existing script).
- [x] Rules test suite green end-to-end (`npm run test:rules`): still 93/93 after Phase 4/5 —
      re-verified twice (once right after Phase 4/5 landed, once again in this pass).
- [x] `npm run build` passes the bundle-size gate: 112.3 KB / 250 KB budget, 137.7 KB headroom.
- [ ] Manual pass (create a lead, add two deals, log activities with mandatory follow-ups,
      close won/lost, verify dashboard counts, verify offline sync): **not done** — needs a
      real signed-in session against the Auth emulator, which this sandbox could not do (see
      the Phase 1/2 notes on the Auth emulator binary not being downloadable here; retried
      again in this pass, same result — see below). **This is the one item that genuinely
      needs the owner's own machine**: `npm run dev:emulators`, then `npm run seed`, then
      `npm run dev`, sign in as `agent1@haflaway.com` / `haflaway123` (or any seeded account —
      the seed script prints the full list), and walk through the pass above.

---

## 8. Localisation

Swahili-first UI (field staff), English available. Reuse `Africa/Dar_es_Salaam` timezone handling
from `periods.js`. Event vocabulary: *Harusi*, *Send-off*, *Kitchen party*, *Mahafali*,
*Kumbukumbu*, *Corporate*, *Other* (unchanged from the legacy plan — still accurate).

## 9. Open questions

None blocking right now — the owner answered the load-bearing ones in conversation (§1). If a new
ambiguity turns up while building, add it here with the question, what it blocks, and a
recommendation, rather than guessing silently.
