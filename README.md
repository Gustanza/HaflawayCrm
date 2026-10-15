# HaflaCREM

A simple Salesforce-style CRM built with Vue 3, Vite and Firebase (Auth + Firestore).

## Features
- **Leads** with a status Path and one-click **Convert** (creates Account, Contact and optional Opportunity)
- **Accounts** and **Contacts** with related lists
- **Opportunities** with a stage Path, a Closed Won celebration, and a drag-and-drop **Kanban** pipeline
- **Tasks** plus an **Activity timeline** on every record (log a call, new task, notes, automatic stage-change history)
- **Home** page (quarterly performance, key deals, today's tasks, assistant) and a **Dashboard**
- **Global search**, list views, sorting, inline edit, real-time updates across users

## Run
```sh
npm install
npm run dev
```

## Shared Firebase project
HaflaCREM shares the `haflawaycrm` Firebase project with the older **Haflaway CRM** app. HaflaCREM keeps all of its data in `crm_*` collections (`crm_leads`, `crm_accounts`, ...); the old app owns `leads`, `users`, `orgs`, `leadPhoneIndex`, and so on. Never delete the old app's collections from HaflaCREM's side.

**Importing old data:** avatar menu → **Import from Haflaway CRM** → Scan → Download backup → Import. The tool only reads the old app's data and copies it into `crm_*`; re-running skips anything already imported. The mapping lives in [`src/migration/haflaway.js`](src/migration/haflaway.js).

**Safe testing:** `npm run emulators` + `npm run dev:emu` runs everything against a local emulator. A walkthrough is in [`docs/TEST-WALKTHROUGH.md`](docs/TEST-WALKTHROUGH.md).

## Firebase setup (one time)
1. Firebase console → Authentication → Sign-in method: enable **Email/Password**.
2. Firestore → Rules: make sure the published rules include both sections of [`firestore.rules`](firestore.rules) (HaflaCREM's `crm_*` block **and** the old app's block) and **Publish**.
3. Deploy the rules and functions (see **Going live** below), then log in as **haflaway@gmail.com**, the super admin. If that account doesn't exist yet, create it in Firebase console → Authentication → **Add user** first.

## Users and access
There is no sign-up page. The admin adds people under **Users** (nav tab, or avatar menu → **Users & Access**).

| Role | Can do |
|---|---|
| **Super Admin** (haflaway@gmail.com) | Everything an admin can. Always an admin; can't be demoted or deactivated. |
| **Admin** | Sees and edits every record. Adds users, changes roles, resets passwords, deactivates people, and moves records between owners. Sees the whole team's SMS and can send or cancel any of them. |
| **Sales Rep** | Sees and works **only the records they own**. Can't give records to someone else. |

- **Owners:** a rep owns what they create. An admin picks the owner when creating a record, and can change it with **Owner → Change** on the record page. That moves the record's tasks, activity and waiting SMS too; for an account it also moves its contacts and opportunities.
- **Leaving staff:** use **Deactivate** (signs them out, blocks login), then **Move records** to hand their book to someone else.
- **Oversight:** list pages have an owner filter for admins; the Dashboard has a person picker and a **Team Performance** table.
- **People who signed up before this existed** show as **Waiting for access** until an admin gives them a role. Records owned by old Haflaway accounts, or by nobody, are listed under **Records Without a Team Owner**.
- Roles are stored on `crm_users/{uid}` (`role`, `active`) and only change through the admin Cloud Functions in [`functions/users.js`](functions/users.js). [`firestore.rules`](firestore.rules) enforces all of it. The super admin email is hard-coded in `firestore.rules`, `functions/users.js` and `src/store.js`; change all three together.

Firebase config lives in [`fireCreds.js`](fireCreds.js). Object fields, list views and stages are defined in [`src/meta/objects.js`](src/meta/objects.js); edit that file to add fields or change picklists. Currency is set by `CURRENCY` in the same file.

## SMS to clients (SMTZ)
The app never texts anyone by itself. When something happens, Cloud Functions in [`functions/`](functions/) write an SMS **draft**. The record's owner gets a prompt and an inbox badge, and chooses **Send**, **Edit** (text or number) or **Cancel**. Drafts expire after 24 hours. Every sent SMS appears on the record's activity timeline.

| When | Message |
|---|---|
| A lead is created in the app (not imports) | Welcome |
| A job moves to **Quote Sent** | Price + how to pay |
| **Amount Paid** goes up | Receipt with the remaining balance |
| A job moves to **Client Approval** | Design is ready, please reply |
| A job moves to **Completed** | Thank you (no festive wording for Funeral / Msiba or Memorial jobs) |

Moving a job to another stage, including back to an earlier one after a mis-drag, retires its unsent stage message. Between 20:00 and 08:00 (Tanzania time), Send asks whether to send now anyway or schedule the message for 08:00. Default wording is in [`functions/templates.js`](functions/templates.js) and the trigger rules are in [`functions/sms.js`](functions/sms.js).

**Going live (one time, needs the Blaze plan):**
```sh
cd functions && npm install && cd ..
firebase functions:secrets:set SMTZ_API_KEY          # paste the SMTZ API key when prompted
cp functions/.env.example functions/.env.haflawaycrm # set SMTZ_SENDER_ID and SMS_STAFF_EMAILS
firebase deploy --only functions,firestore:rules
```
`SMS_STAFF_EMAILS` lists the reps who may send SMS for their own records; admins can always send. `REGION` in `functions/index.js` and `FUNCTIONS_REGION` in `fireCreds.js` must both match the Firestore database location.

**Testing:** `cd functions && npm test` runs the unit tests. To test end to end, start `npm run emulators` and then run `node scripts/sms-emulator-test.mjs`. The emulator uses `SMS_DRY_RUN=true`, so it never sends a real SMS. The same script checks roles and access (reps can't see each other's records, deactivation, moving records). To try it in the browser, run `npm run dev:emu`, add `haflaway@gmail.com` in the Emulator UI (http://127.0.0.1:4000/auth), log in, and add other users from **Users**.
