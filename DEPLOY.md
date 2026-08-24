# Deploying, and getting your first admin in

The order matters. Rules before app, and the first admin cannot be created from inside the
app — there is no self-signup, so a freshly deployed project has nobody who can let anybody
in. `scripts/bootstrap-admin.js` is the way through that.

---

## 1. Before you deploy anything

```bash
npm run test:all        # 270 unit · 34 view-mount · 122 rules
npm run build           # also asserts the bundle budget
```

Check the Firebase console has these enabled on the **production** project:

- **Authentication → Sign-in method → Email/Password**: enabled
- **Firestore**: created, in Native mode
- **Storage**: enabled

> ⚠️ **The Firestore region is permanent.** Confirm it before there is any production data —
> changing it later means an export/import migration. See TODO.md D2.

---

## 2. Deploy rules first, then the app

```bash
npm run deploy:rules      # firestore.rules + firestore.indexes.json + storage.rules
npm run deploy:hosting    # build, then deploy
```

Or `npm run deploy` for both, in that order.

**Rules first, always.** Deploying the app before its rules leaves a window in which the
database is governed by whatever was there before — on a new project that is the default
`allow read, write: if false` (harmless), but on a project someone has clicked around in it
can be the 30-day open test mode (not harmless at all).

Composite indexes build asynchronously. A query that needs one fails with *"The query
requires an index"* until it finishes — usually a minute or two, longer on a large
collection. Watch **Firestore → Indexes** in the console.

---

## 3. Create the first admin — the in-app route (easiest)

Deploy, then:

1. **Firebase console → Authentication → Add user.** Email and a temporary password. That
   is all the console can do — it has no UI for custom claims.
2. Sign in to the app with that account. You land on *"Your account is not set up yet"*.
3. Click **Setup**. Because nobody is an administrator yet, it offers a one-time claim.
   Take it. You are now admin, and you land in the app.
4. From that same **Setup** screen, add everyone else — account, role, profile and name
   mirror, all in one form. Each person gets an email to choose their own password.

No terminal, no service-account key.

**How this works without custom claims.** A browser cannot set one. So `firestore.rules`
reads the claim **first** and falls back to `users/{uid}` when there is none — Firestore
evaluates only the taken branch of a ternary, so a claim-holder pays no extra read, and the
fallback costs one document read only for accounts that have not been synced yet.

Run `npm run claims` occasionally to convert the fallback into the zero-read fast path. It
is an optimisation, not a requirement — the Setup screen says so.

**The claim can only be taken once.** `settings/bootstrap` is a one-way latch: whoever
claims it is stamped by uid, and no rule anywhere sets it back to `false`. A second person
is refused. Deploy with:

```json
// settings/bootstrap
{ "claimed": false, "claimedBy": null, "orgId": "haflaway" }
```

If that document is missing, the Setup screen says so and points at the script below.

---

## 3a. Create the first admin — the script route

You need a **service-account key**: Firebase console → ⚙ Project settings → Service accounts
→ *Generate new private key*. It downloads a JSON file.

> That file is a master key to your entire project. `.gitignore` already excludes
> `serviceAccountKey.json`; keep it out of the repo, out of chat, and delete it when you are
> done. It bypasses every security rule in `firestore.rules`.

**Windows (PowerShell):**

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"
node scripts/bootstrap-admin.js --prod --email=you@haflaway.com --name="Asha Mwinyi"
```

**macOS / Linux:**

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
node scripts/bootstrap-admin.js --prod --email=you@haflaway.com --name="Asha Mwinyi"
```

It prints a **password-reset link**. Open it and set your password.

No password is set or printed by design: a password typed on a command line ends up in your
shell history, in the process list, and in whatever terminal scrollback gets screenshotted
into a group chat. `--password` exists for emulator work and is **refused** against
production.

### What the script actually does

Three things that must all happen, or the account half-works:

| | Without it |
|---|---|
| Creates the Firebase Auth user | They cannot authenticate at all |
| Sets the **custom claims** | They sign in and land on *"Your account is not set up yet"* |
| Writes `users/{uid}` + `usersPublic/{uid}` | The app works but shows a raw uid where their name should be |

The claims are the part people miss. `firestore.rules` authorises from the Auth **custom
claim**, never from a document read — so creating a user document by hand grants nothing.

It is **idempotent**: run it again on an existing account and it re-grants the role rather
than failing. Safe to re-run if you are not sure it completed.

### Guards

| You run | It does |
|---|---|
| no `--emulator`, no `--prod` | **Refuses.** Touching a live database should not be the quiet default |
| `--prod --password=…` | **Refuses.** See above |
| `--org=haflaway_tz` | **Refuses.** `orgId` is the prefix of the `leadPhoneIndex` key and must not contain `_` |
| `--email=notanemail` | **Refuses** |

---

## 3b. "Can I just create the user in the Firebase console?"

Partly. You can create the **account** there, but the console has no UI for custom claims,
and claims are what `firestore.rules` actually reads. So the console alone gets you an
account that can authenticate and do nothing else.

Measured against the real rules, on an account created exactly as the console creates one:

| What you have done | Signs in | `canUseApp` | Read own profile | List leads |
|---|---|---|---|---|
| Created in the Auth console, nothing else | ✅ | ❌ `/no-access` | DENIED | DENIED |
| …**plus** `users/{uid}` written by hand with `role: "admin"` | ✅ | ❌ `/no-access` | DENIED | DENIED |
| …**plus** `node scripts/syncClaims.js` | ✅ | ✅ **in the app** | OK | OK |

**Row two is the trap.** The document says `role: "admin"` and it changes nothing, because
`firestore.rules` authorises from the Auth **custom claim**, never from a document read — a
rule that fetched `users/{uid}` would bill a document read on every single operation for all
50 staff (§7.1). The document is the profile the UI renders; the claim is the permission.

So the console route is:

1. **Firebase console → Authentication → Add user** (email + a temporary password)
2. **Create `users/{uid}`** with at least `orgId`, `role`, `isActive: true`, `displayName`
   — the uid is shown in the Auth user list
3. **Run the script anyway**, because only it can set claims:

   ```bash
   node scripts/syncClaims.js --uid=<the-uid>     # reads the doc, writes the claim
   ```

Which is three steps and a script, versus one command that does all of it:

```bash
node scripts/bootstrap-admin.js --prod --email=you@haflaway.com --name="Asha Mwinyi"
```

Use the console route if you prefer, but you cannot skip the script. There is no way to set
a custom claim without the Admin SDK.

**If you go the console route, also create `usersPublic/{uid}`** (`orgId`, `displayName`,
`photoPath: null`, `isActive: true`). Nothing breaks without it, but the CAC-per-staff table
and anywhere else that resolves a name will show a raw uid instead — `users/{uid}` is not
readable by every role, which is why the redacted mirror exists (§7.1).

---

## 4. Everyone else

Once you can sign in as admin, add staff from **Users** in the app — *but read the amber
warning on that screen*. Changing a role there updates the document; it does **not** grant
access until the claim is synced.

The same script creates any role:

```bash
node scripts/bootstrap-admin.js --prod --email=neema@haflaway.com \
  --name="Neema Shirima" --role=manager --team=team-dar
```

Roles: `admin` · `manager` · `finance` · `agent` · `viewer` (see [TEST-ACCOUNTS.md](TEST-ACCOUNTS.md)).

To re-sync every claim from the user documents after editing roles in the app:

```bash
node scripts/syncClaims.js --dry-run     # show what would change
node scripts/syncClaims.js               # apply
```

---

## 5. Verify the deployment

1. Open the hosting URL. You should get the **sign-in screen**, not a blank page.
2. Sign in as your admin. You should land on the **work queue**, not `/no-access`.
3. Open **Analytics**. Figures will be empty — there is no data yet — but nothing should
   render `TZS 0` where it means *unknown*.
4. Add one lead. Confirm it appears in **Leads**.
5. Open the browser console. A red *"The query requires an index"* means an index is still
   building — wait, then reload.

---

## Troubleshooting

**"Your account is not set up yet" after signing in.** The claims did not reach the token.
Sign out and back in — a token is cached for up to an hour. If it persists, re-run the
bootstrap script; it is idempotent.

**"Missing or insufficient permissions" on every screen.** Rules deployed but claims not
set, or `orgId` in the claim does not match the `orgId` on the documents. Check with:

```bash
node scripts/syncClaims.js --dry-run
```

**"The query requires an index".** `npm run deploy:rules` deploys
`firestore.indexes.json`; the build is asynchronous. Check Firestore → Indexes.

**A blank white page on the hosting URL.** Almost always missing `VITE_FB_*` env vars at
**build** time — Vite inlines them into the bundle, so they must be present when
`npm run build` runs, not when the app runs. `src/main.js` catches this and renders a
bilingual message rather than nothing; a truly blank page means the JS never loaded at all.

**The app talks to the emulator in production.** `src/firebase/app.js` only connects to
emulators when `import.meta.env.DEV` is true, so a production build never does. If you see
emulator traffic, you deployed a dev build.

---

## What is NOT set up yet

Honest list — none of these block launch, but do not be surprised:

- **No CI.** Tests and deploys are manual.
- **No scheduled jobs.** The nightly score recompute and rollups (TODO.md Phase 6) need
  Cloud Functions and the Blaze plan — decision **D1**, still open.
- **No backups.** Set up scheduled Firestore exports before real customer data lands
  (Phase 9). An untested backup is not a backup.
- **No custom domain.** Firebase gives you `<project>.web.app`; a custom domain is
  configured in Hosting.
- **No error tracking.** Sentry is Phase 9. Until then a field bug is invisible to you.
