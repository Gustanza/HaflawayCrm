# Test Accounts & Roles

Every seeded account, what each role can and cannot do, and what to click to prove it.

> **These credentials are for the LOCAL EMULATOR ONLY.**
> `scripts/seed.js` refuses to run against anything but `127.0.0.1`, and the password below
> is hard-coded in that script. Nothing here exists in production, and no real account
> should ever use these values.

**Password for every account: `haflaway123`**

Prerequisites — both must be running:

```bash
npm run dev:emulators    # terminal 1 — Auth 9099, Firestore 8080, Storage 9199
npm run seed             # terminal 2 — once the emulators are up
npm run dev              # terminal 3 — http://localhost:5173
```

Re-running `npm run seed` wipes and rebuilds everything, including these accounts.

---

## Accounts

Organisation `haflaway` · Teams: **team-dar** (Dar es Salaam) · **team-mwanza** (Mwanza)

| Email | Password | Name | Role | Team | Leads owned |
|---|---|---|---|---|---|
| `admin@haflaway.com` | `haflaway123` | Asha Mwinyi | **admin** | team-dar | — |
| `finance@haflaway.com` | `haflaway123` | Juma Kileo | **finance** | team-dar | — |
| `manager.dar@haflaway.com` | `haflaway123` | Neema Shirima | **manager** | team-dar | — |
| `manager.mwanza@haflaway.com` | `haflaway123` | Baraka Massawe | **manager** | team-mwanza | — |
| `agent1@haflaway.com` | `haflaway123` | Zawadi Mrema | agent | team-dar | 7 (4 open) |
| `agent2@haflaway.com` | `haflaway123` | Frank Ndosi | agent | team-dar | 7 (4 open) |
| `agent3@haflaway.com` | `haflaway123` | Halima Suleiman | agent | team-dar | 7 (6 open) |
| `agent4@haflaway.com` | `haflaway123` | Emmanuel Kessy | agent | team-dar | 7 (5 open) |
| `agent5@haflaway.com` | `haflaway123` | Grace Mollel | agent | team-mwanza | 7 (6 open) |
| `agent6@haflaway.com` | `haflaway123` | Ibrahim Juma | agent | team-mwanza | 7 (5 open) |
| `agent7@haflaway.com` | `haflaway123` | Rehema Chuwa | agent | team-mwanza | 6 (4 open) |
| `agent8@haflaway.com` | `haflaway123` | Peter Mbwana | agent | team-mwanza | 6 (4 open) |
| `viewer@haflaway.com` | `haflaway123` | Board Viewer | **viewer** | team-dar | — |
| `exstaff@haflaway.com` | `haflaway123` | Former Staff | agent | team-dar | 6 — **DEACTIVATED** |

Seeded data: **60 leads** (40 open) · 34 in team-dar, 26 in team-mwanza · 50 open tasks ·
5 campaigns · ~114 expense entries across 3 months · 14 users.

### `exstaff@haflaway.com` is deactivated on purpose

Sign-in is **refused**. The account exists in Auth but is disabled, and its `active` claim
is false. It is seeded that way so the deactivation path stays testable without anyone
having to break a working account first — and so the six leads it owns prove that
deactivating a person does not delete their pipeline.

---

## What each role can do

Taken from `src/stores/auth.js` (`can`), `src/router/index.js` (route gates) and
`firestore.rules`. The rules are the authority — the UI only hides what the server would
refuse anyway.

| | admin | manager | finance | agent | viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| **Leads visible** | all | own team | all | **own only** | all |
| Create a lead | ✅ | ✅ | — | ✅ | — |
| Reassign a lead | ✅ | ✅ (own team) | — | — | — |
| Change a lead's stage | ✅ | ✅ (own team) | — | ✅ (own) | — |
| Log an activity | ✅ | ✅ (own team) | — | ✅ (own) | — |
| **See cost data** | ✅ | ✅ | ✅ | **❌** | **❌** |
| Add an expense | ✅ | — | ✅ | — | — |
| Lock a month (§9) | ✅ | — | ✅ | — | — |
| Manage users & roles | ✅ | — | — | — | — |
| Read the audit log | ✅ | — | — | — | — |

### Screens by role

| Screen | admin | manager | finance | agent | viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| Work queue | ✅ | ✅ | ✅ | ✅ | ✅ |
| Leads · Upcoming events · Lead detail | ✅ | ✅ | ✅ | ✅ | ✅ |
| New lead | ✅ | ✅ | — | ✅ | — |
| Pipeline | ✅ | ✅ | ✅ | — | ✅ |
| Analytics | ✅ | ✅ | ✅ | — | ✅ ¹ |
| Campaigns | ✅ | ✅ | ✅ | — | — |
| Expenses | ✅ | — | ✅ | — | — |
| Users | ✅ | — | — | — | — |
| Settings | ✅ | ✅ | ✅ | ✅ | ✅ |

¹ A viewer opens Analytics but **cannot read expenses**, so every cost figure would compute
to zero. Rather than display "CAC: TZS 0" — which reads as *customers are free* — the whole
cost half of the dashboard is hidden and the reason is stated on screen. Volume metrics only.

---

## What to check with each account

### `agent1@haflaway.com` — the primary user

The person the product is actually built for. Everything else is management reporting.

- **Work queue** shows 4 open leads, split Overdue / Today / Coming up.
- Tap **Andika** (Log) → outcome chips → "Remind me when?" → save. Should be **three taps**.
- **Time yourself adding a lead.** Budget is 20 seconds (TODO.md P7). This is the one number
  that decides whether the product gets used, and nobody has measured it yet.
- **Leads** search accepts a phone number — paste `+255712345678` or type `0712…`.
- No Pipeline, Analytics, Campaigns, Expenses or Users in the nav. Typing `/expenses`
  straight into the address bar lands on Forbidden, and Firestore refuses the read anyway.

### `manager.dar@haflaway.com` — team scope

- Sees **team-dar** leads only (34 of 60). `manager.mwanza@haflaway.com` sees the other 26.
- **Pipeline** — drag a card between columns, or tap **Hamisha** on a phone. Illegal moves
  give a sentence you can act on, not a permission error.
- **Campaigns** carries an amber caption: a manager sees org-wide *spend* but only their own
  team's *leads* against it, so every campaign would otherwise look worse than it is.

### `finance@haflaway.com` — the money

- **Expenses** — add one. Note there is no edit or delete button: the ledger is append-only
  (P4), and a correction is a new negative entry. The panel says so.
- The **allocation** field is required — campaign / staff / team / overhead. That single
  field is what makes CAC-per-staff computable at all (§9).
- **Analytics** — the cohort/period toggle, the printed cost policy, `(n=)` denominators.

### `admin@haflaway.com` — everything

- **Users** — change a role and read the amber warning. Editing the document does **not**
  grant access; `firestore.rules` authorises from the Auth custom claim, and only
  `npm run claims` writes claims.
- **Analytics → CAC per staff** — rows with fewer than 3 won deals render greyed, italic and
  flagged ⚠. That is deliberate: a CAC from one deal is noise, and this number ends up in
  pay conversations.

### `viewer@haflaway.com` — read-only, and no money

- Reads every lead, creates nothing.
- **Analytics shows no CAC at all** — see footnote ¹ above. If you ever see "CAC: TZS 0"
  here, that is a bug worth reporting immediately.

### `exstaff@haflaway.com` — the refusal path

- Sign-in fails with a human message, not a Firebase error code.
- Its 6 leads stay in the system and remain visible to admins.

---

## Granting a role to a new account

Editing `users/{uid}` does **not** grant access. `firestore.rules` reads the Auth **custom
claim**, and a rule that fetched the user document would bill a read on every operation for
all 50 staff. `scripts/syncClaims.js` is the only sanctioned way to write claims:

```bash
npm run claims                                                    # sync every user
node scripts/syncClaims.js --emulator --email=you@haflaway.com --role=admin
node scripts/syncClaims.js --emulator --dry-run                   # show what would change
```

If sign-in lands on **"Your account is not set up yet"**, the account exists in Auth but has
no role claim. Run the command above.

---

## Related

- **[TODO.md](TODO.md)** — the specification. §7.1 is the role matrix; §8 is the CAC maths.
- **[README.md](README.md)** — setup, emulators, troubleshooting.
- `scripts/seed.js` — the source of truth for this file. If the two disagree, the script wins.
