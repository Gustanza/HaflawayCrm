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
3. Open the app, click **Create an account**, and start adding records.

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
`SMS_STAFF_EMAILS` is required: anyone can sign up to HaflaCREM, so only the listed emails can send SMS. `REGION` in `functions/index.js` and `FUNCTIONS_REGION` in `fireCreds.js` must both match the Firestore database location.

**Testing:** `cd functions && npm test` runs the unit tests. To test end to end, start `npm run emulators` and then run `node scripts/sms-emulator-test.mjs`. The emulator uses `SMS_DRY_RUN=true`, so it never sends a real SMS. To try it in the browser, run `npm run dev:emu` and sign up as `staff@example.com`.
