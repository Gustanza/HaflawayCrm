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
