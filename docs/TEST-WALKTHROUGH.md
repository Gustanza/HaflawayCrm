# HaflaCREM – Lead-to-Completed Test Walkthrough

Walk one test lead through every step of the business, from first WhatsApp message to a completed, fully paid job. Tick off the checklist at the end as you go.

## Before you start

Use the safe test mode so your test lead never mixes with real clients. It runs a private copy of the CRM on your computer and is wiped when you close it.

1. Open two terminals in the HaflaCREM folder.
2. Terminal 1: run `npm run emulators` and wait for **All emulators ready**.
3. Terminal 2: run `npm run dev:emu`, then open the link it prints (usually http://localhost:5173).
4. Check you are in test mode: the login page works, but your real logins do not exist there. That is correct.

To test on the live system instead, run `npm run dev` and delete the test records afterwards.

**Test data used in this walkthrough** (use your own if you prefer):

| Field | Value |
| --- | --- |
| Your test login | Name: Test Admin, Email: haflaway@gmail.com (the super admin), Password: test1234 |
| Lead name | Neema Joseph |
| Event / Client Name | Harusi ya Neema & Baraka |
| Phone | +255 712 345 678 |
| Event | Wedding, about 6 weeks from today, 350 guests |
| Service | Kadi za Michango |
| Price | TZS 450,000 (deposit TZS 200,000) |

## Part 1 – Capture the lead

A client has just messaged you on WhatsApp. You record them as a Lead with Status **New**.

1. **Create your test account.** The app has no sign-up page (admins add people), so open the Emulator UI at http://127.0.0.1:4000/auth → **Add user**, enter the test login (Display name, Email, Password), then log in to the app with it.
    - Expect: you land on **Home** with "Good morning/afternoon, Test".
2. **Check the form validation.** Go to the **Leads** tab → **New** → click **Save** without typing anything.
    - Expect: red **Complete this field.** under Last Name and Event / Client Name.
    - Type a Last Name: its red message disappears straight away.
3. **Fill in the lead** using the test data:
    - First Name: Neema · Last Name: Joseph
    - Event / Client Name: Harusi ya Neema & Baraka
    - Phone: +255 712 345 678
    - Lead Status: New (already set)
    - Lead Source: WhatsApp · Rating: Hot
    - Event Type: Wedding · Event Date: about 6 weeks from today
    - Service Interested In: Kadi za Michango · Number of Guests: 350
4. Click **Save**.
    - Expect: a green message "Lead "Neema Joseph" was created." and the lead's own page opens.
5. **Check the lead page.**
    - Top card shows the event name, phone, Wedding, the event date and you as Lead Owner.
    - The status bar (Path) shows **New** in dark blue.
6. **Check the list.** Click the **Leads** tab.
    - Expect: Neema Joseph is in **Open Leads** with Wedding and the event date.

## Part 2 – Work the lead

You follow up with the client, record every contact, and move the status forward.

**Calendar**

1. On the **Leads** tab click the **calendar icon** (top right, next to the table icon).
2. Use **›** or the month picker to go to the event's month.
    - Expect: "Neema Joseph · New" in blue on the event date.
3. Click the **Working** filter chip.
    - Expect: Neema disappears (she is New, not Working).
4. Click **New** as well.
    - Expect: Neema shows again; the agenda list under the calendar shows her date, event, status and phone.
5. Click **All** to reset, then click Neema's name on the calendar to open her page.

**Record your contact with the client** (Activity panel, right side of the lead page)

6. **Log a Call**: Subject "First call", Comments "Wants michango cards for 350 guests" → **Log Call**.
    - Expect: it appears under the month heading in the timeline.
7. **New Task**: Subject "Send price list", Due date = today → **Save**.
    - Expect: it appears under **Upcoming & Overdue**, and on **Home → Today's Tasks**.
8. **Note**: write "Prefers gold design" → **Save**.
    - Expect: it appears in the timeline; the small arrow next to it shows the full text.

**Move the status**

9. On the Path click **Mark Status as Complete**.
    - Expect: New turns green with a tick, **Working** is now current, and the timeline shows "Lead Status changed from New to Working".
10. Click the **Nurturing** step, then **Mark as Current Status**.
    - Expect: Nurturing is current and a second "changed" entry appears.
11. Go back to the calendar.
    - Expect: Neema now shows "Nurturing" in teal.

**Search**

12. Type "Neema" in the search bar at the top.
    - Expect: Neema appears in the suggestions; pressing Enter opens a results page listing her.

## Part 3 – Convert the lead

The client says yes, so the lead becomes a real job. One click creates three records: the **Account** (the event), the **Contact** (the person) and the **Opportunity** (the job for one service).

1. On Neema's lead page click **Convert** (top right).
2. Check the defaults in the Convert box:
    - Account → Create New: "Harusi ya Neema & Baraka"
    - Contact → Create New: Neema Joseph
    - Opportunity → Service: Kadi za Michango; Opportunity Name: "Harusi ya Neema & Baraka - Kadi za Michango"
3. Optional check: change Service to Save the Date. The name follows it. Change it back. If you type your own name first, changing Service keeps your name.
4. Click **Convert**.
    - Expect: "Your lead has been converted" with three cards: Account, Contact, Opportunity.
5. Click **Done**, then check:
    - The lead page shows a grey banner "This lead was converted on …" with links. Its Path steps can no longer be clicked.
    - **Leads** tab: Neema is gone from Open Leads but is listed under **Converted Leads** (view dropdown).
    - Calendar: Neema now shows **Converted** in green.
6. Open the **Account** (link in the banner).
    - Expect: Event Type Wedding and the event date copied over; Related tab lists Neema (contact) and the new job.
    - Expect: the Activity timeline shows your earlier call, note and task. They moved with the client, plus a "Lead converted from Neema Joseph" entry.
7. Open the **Opportunity** (the job) from the Related tab.
    - Expect: Service, Event Type, Event Date and Guests (350) are filled in; Stage = **Inquiry**; Delivery Date = 7 days before the event.

## Part 4 – Run the job through its stages

The job moves Inquiry → Quote Sent → Deposit Paid → Design → Client Approval → Sending. The key money rule: a balance only counts as **owed** from Deposit Paid onwards.

**Inquiry → Quote Sent (price agreed, no money yet)**

1. On the job page click **Edit** → Total Price **450000**, Amount Paid **0** → **Save**.
    - Expect: Balance shows TZS 450,000.
2. Click **Mark Stage as Complete** → stage becomes **Quote Sent** (Probability 30%).
3. Check the job is **not** treated as owing yet:
    - **Opportunities** tab → Kanban icon: the card shows no red "owes".
    - **Dashboards**: Unpaid Balances does not include it.

**Deposit Paid (client pays TZS 200,000)**

4. Click **Mark Stage as Complete** → **Deposit Paid** (70%).
5. In the **Details** tab click the pencil next to Amount Paid, enter **200000**, click **Save**.
    - Expect: Balance TZS 250,000.
6. Check it now counts as owed:
    - Kanban card shows red **owes TZS 250,000**.
    - Dashboard → Clients With Unpaid Balances lists the job.
    - Home → Assistant says "1 client owes TZS 250,000 in total".

**Design → Client Approval → Sending**

7. Open the **Job Board** (Opportunities tab → Kanban icon) and drag the card from **Deposit Paid** to **Design**.
    - Expect: green message "moved to Design"; on the job page the Path shows Design and Probability 80%.
8. On the job page, Log a Call "Sent first design to client", then **Mark Stage as Complete** → **Client Approval**.
9. **Mark Stage as Complete** again → **Sending** (95%).
10. Optional safety check: open the Details pencil editor, then (while it is open) click **Mark Stage as Complete**, change only Next Step and Save. The stage must **not** jump back.

**Calendar for jobs**

11. On the Opportunities tab click the **calendar icon**.
    - Expect: the job on its event date, coloured by stage; the stage chips filter it the same way as for leads.

## Part 5 – Finish the job

The cards are sent and the client pays the balance. You mark the job **Completed** and check that every total updates.

**Complete the job**

1. On the job page click **Finish Job** (or the **Done** step).
2. In the box choose **Completed (job delivered)** → **Save**.
    - Expect: confetti, the last step turns green, Probability 100%, and **Completed Date** = today in Details.
3. Pencil-edit Amount Paid to **450000** → **Save**.
    - Expect: Balance TZS 0; the job leaves every unpaid list and the Assistant message disappears.

**Check the totals**

4. **Account page** (Harusi ya Neema & Baraka) → Related tab.
    - Expect: Open jobs TZS 0, Unpaid balance TZS 0, the job listed as Completed; the timeline shows every stage change.
5. **Dashboards**:
    - Completed (this quarter) TZS 450K, Average Job Value TZS 450K
    - Completed Revenue by Month: bar in the current month
    - Completed Revenue by Service: Kadi za Michango
    - Win Rate 100%, Leads by Source: WhatsApp 1
6. **Home**: Quarterly Performance shows TZS 450,000 under Completed and the goal bar moves.

**A lost job**

7. On the Account page → Related → Opportunities → **New**: Service "SMS Reminder za Michango", Total Price 120000, any Delivery Date → **Save**.
    - Expect: the Account is filled in for you.
8. Click **Finish Job** → choose **Lost** → **Save**.
    - Expect: the last step turns red, no confetti, Probability 0%.
    - Dashboard Win Rate drops to **50%**; the lost job is not counted as owed.
9. Optional: move the first job back to Sending, then finish it again. Completed Date clears, then returns.

## Part 6 – Housekeeping checks

These confirm deleting, tasks and logging out behave safely.

1. **Delete**: create a lead called "Throwaway" (any company), open it, click **Delete** → **Delete**.
    - Expect: you return to the Leads list with "Lead "Throwaway" was deleted." and it is gone.
2. **Complete a task**: on **Home → Today's Tasks**, tick the "Send price list" box.
    - Expect: it disappears from Today's Tasks and shows as done (struck through) in the Account timeline.
3. **Unqualified lead**: create another lead, then **Edit** → Lead Status **Unqualified** → Save.
    - Expect: the Path shows no action button and a note to select a step; on the calendar it shows grey with a dashed edge.
4. **Back button**: on Opportunities switch views (e.g. All Opportunities → Unpaid Balances), then press the browser **Back** button.
    - Expect: the list switches back without reloading.
5. **Log out**: click your initials (top right) → **Log Out**.
    - Expect: the login page.
6. While logged out, type `/o/leads` after the address and press Enter.
    - Expect: you are sent to the login page; after logging in you land on Leads.
7. When finished, stop both terminals (Ctrl + C). All test data is wiped.

## Results checklist

Mark each check as you go. Anything that fails goes in Notes: what you clicked, what you expected, what happened.

| # | Check | Part | Result (Pass / Fail) | Notes |
| --- | --- | --- | --- | --- |
| 1 | Lead created; validation messages show and clear | 1 | | |
| 2 | Calendar shows the lead; status filters and agenda work | 2 | | |
| 3 | Call, task and note appear in the timeline and on Home | 2 | | |
| 4 | Path moves New → Working → Nurturing with history entries | 2 | | |
| 5 | Convert creates Account, Contact, Job with details copied; history moves to the Account | 3 | | |
| 6 | Balance not owed at Quote Sent; owed from Deposit Paid | 4 | | |
| 7 | Kanban drag moves the job to Design | 4 | | |
| 8 | Finish Job → Completed: confetti, Completed Date, balance clears after full payment | 5 | | |
| 9 | Account and Dashboard totals correct; Lost job gives 50% win rate | 5 | | |
| 10 | Delete, task tick, Back button and logout behave | 6 | | |

To report a problem, send the check number, a screenshot, and the Notes text.
