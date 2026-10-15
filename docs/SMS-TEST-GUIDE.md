# HaflaCREM SMS: End-to-End Test Guide

One test client, taken from first contact to finished job, sends 6 SMS. Each one waits for you to press Send. Plan about 30 minutes, between 08:00 and 20:00.

## Before you start

- **Log in as an SMS sender.** Only haflaway@gmail.com and gustanzasam@gmail.com can send for now. Any other account sees the prompts, but Send is refused.
- **Use your own mobile number** for the test client, so every SMS lands on a phone you hold. Keep a second number handy for the edit test in Step 3.
- **Open the live app:** https://haflasalesforce.web.app
- **Know where to check each result:**
  - Your phone: the SMS arrives from HAFLAWAY.
  - The record's activity timeline: an "SMS sent" entry with the exact text.
  - The SMTZ dashboard, under Campaigns: one campaign per SMS, named "CRM <message type>: <record name>".
- **Every SMS costs real credit.** A full run sends about 6 messages.

## Step 1: Collect the lead (Welcome SMS)

1. Go to **Leads** and press **New**.
2. Fill in:
   - First Name: Test
   - Last Name: Client
   - Event / Client Name: Harusi ya Test
   - Phone: your own mobile, in any format (0712 345 678 or +255 712 345 678)
   - Service Interested In: Kadi za Michango
   - Event Type: Wedding
   - Event Date: about two months from today
3. Press **Save**.
4. **Expect:** within about 5 seconds, a card slides in at the bottom right: "Welcome", addressed to Test, with your number.
5. Read the message, then press **Send**.
6. **Expect:**
   - A green "SMS sent" notice in the app.
   - On your phone, from HAFLAWAY: "Habari Test, asante kwa kuwasiliana na Haflaway! <your first name> atakupigia hivi karibuni kuhusu Kadi za Michango. Karibu sana."
   - On the lead's activity timeline: "SMS sent: Welcome".

If no card appears, look for a red number on the speech-bubble icon in the header. That inbox holds every waiting SMS.

## Step 2: Convert the lead into a job (no SMS)

1. Optional: on the lead's stage bar, mark it Working, then Nurturing. These stages send nothing.
2. Press **Convert** at the top of the lead.
3. Keep **Create New** account, leave the opportunity ticked, keep the Service as Kadi za Michango, then press **Convert**.
4. Open the new **opportunity** (the job). It starts at **Inquiry**.
5. On the job, press **Edit** and set **Total Price** to 350,000. Leave Amount Paid empty. Press **Save**.
6. **Expect:** no SMS card. Converting and editing the price send nothing.

The job's SMS go to its primary contact. Conversion copies the lead's phone onto that contact, so they still reach your phone.

## Step 3: Send the quote (Quote SMS, plus edit and mis-drag tests)

**Mis-drag test first:**

1. Go to **Opportunities** and switch to the board view (the Kanban icon beside the search box).
2. Drag the test job from Inquiry to **Quote Sent**.
3. **Expect:** a "Quote sent" card: "Habari Test, bei ya Kadi za Michango ni TZS 350,000. Lipa amana ili tuanze kazi yako. Asante!"
4. Without pressing anything, drag the job back to **Inquiry**.
5. **Expect:** the card disappears within a few seconds and nothing is sent.

**Edit test:**

6. Drag the job to **Quote Sent** again. A fresh card appears.
7. Press **Edit**. Change the number to your second phone and add a sentence, for example "Lipa Namba: 123456."
8. Watch the counter under the text. It turns orange if the message goes over 160 characters (2 SMS).
9. Press **Send**.
10. **Expect:** the edited text arrives on the second phone, not the first. The timeline shows "SMS sent: Quote sent" with the edited text and the new number.

## Step 4: Record the deposit (Payment receipt SMS)

1. Move the job to **Deposit Paid**. The stage alone sends nothing.
2. Open the job, press **Edit**, set **Amount Paid** to 100,000, and press **Save**.
3. **Expect:** a "Payment receipt" card: "Habari Test, tumepokea malipo ya TZS 100,000. Salio lililobaki ni TZS 250,000. Asante!"
4. **Merge test:** don't send yet. Edit Amount Paid to 150,000 and save.
5. **Expect:** the first card disappears and a new one reads "TZS 150,000 ... Salio lililobaki ni TZS 200,000". The client gets one receipt, not two.
6. Press **Send** and check that it arrives on your first phone.

## Step 5: Design and client approval (Approval SMS)

1. Move the job to **Design**. **Expect:** no card. Design has no SMS yet.
2. Move the job to **Client Approval**.
3. **Expect:** a "Design ready for approval" card: "Habari Test, rasimu ya Kadi za Michango iko tayari! Tafadhali iangalie na utujibu ili tuanze kutuma kwa wageni wako."
4. Press **Send** and check your phone.

## Step 6: Final payment and finish (Receipt + Thank-you SMS)

1. Move the job to **Sending**. **Expect:** no card.
2. Edit **Amount Paid** to 350,000 and save.
3. **Expect:** a receipt card ending "Malipo yako yamekamilika. Asante!" Press **Send**.
4. On the job's stage bar, press **Finish Job**, choose **Completed (job delivered)**, and press **Save**.
5. **Expect:** a "Job completed" card: "Habari Test, kazi ya Kadi za Michango imekamilika. Asante kwa kuchagua Haflaway! Karibu tena na uwaambie marafiki." It has no "Salio" line because the balance is 0.
6. Press **Send**.

**Final check:** the job's timeline shows 5 "SMS sent" entries: quote, receipt, approval, receipt, then completed. The Welcome SMS appears on the contact's timeline, because converting a lead moves its history to the new contact. The SMTZ dashboard lists one campaign per SMS.

## Extra checks

Each check takes a minute or two. Use a fresh test lead for each so the main run stays clean.

1. **Cancel:** create a lead, then press **Cancel** on its card. Expect "SMS cancelled. Nothing was sent.", no SMS and no timeline entry.
2. **Hide and inbox:** create a lead and press the **x** on its card. Expect a red badge on the speech-bubble icon in the header. Open it and send from there.
3. **No phone number:** create a lead with no Phone. Expect the card to open in edit mode with "This record has no mobile number", and Send stays greyed out until you type a valid number.
4. **Quiet hours (after 20:00):** press Send. Expect a yellow box offering **Send at 08:00** or **Send now anyway**. Choose 08:00: the card shows "Will send ..." and the SMS arrives by about 08:15 next morning. The check runs every 15 minutes.
5. **Expiry:** leave a card untouched for 24 hours. Expect it to drop out of the inbox, unsent.
6. **Funeral wording:** finish a job whose Event Type is Funeral / Msiba. Expect the completed message without "Asante kwa kuchagua" or "Karibu tena".
7. **Non-staff account:** log in with an email not on the SMS list and press Send. Expect a refusal naming that email.
8. **Owner only:** a job owned by another user never shows in your inbox. Only its owner gets the card.
9. **Phone screen:** repeat any step on your phone. The card should stretch across the bottom of the screen.

## Results checklist

Mark each row as you go. Anything marked Fail, write what you saw in Notes and send it to me.

| # | Check | Expected | Result | Notes |
| --- | --- | --- | --- | --- |
| 1 | Welcome SMS | Arrives from HAFLAWAY; on the timeline | | |
| 2 | Conversion | No SMS card | | |
| 3 | Mis-drag back to Inquiry | Quote card disappears, nothing sent | | |
| 4 | Edited quote | Edited text arrives on the second phone | | |
| 5 | Two payments, one receipt | One receipt for TZS 150,000 | | |
| 6 | Approval SMS | Arrives on Client Approval | | |
| 7 | Final receipt | Ends "Malipo yako yamekamilika" | | |
| 8 | Job completed SMS | Thank-you, no Salio line | | |
| 9 | Cancel | Nothing sent | | |
| 10 | Hide and inbox | Badge shows; sends from inbox | | |
| 11 | No phone number | Send blocked until a valid number | | |
| 12 | Quiet hours | Schedule option; arrives by 08:15 | | |
| 13 | Expiry | Gone after 24 hours, unsent | | |
| 14 | Funeral wording | No festive lines | | |
| 15 | Non-staff account | Send refused | | |
| 16 | Phone screen | Card fits the screen | | |
