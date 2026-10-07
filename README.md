# Area Supa Ventures: susu collection web app

An installable web app (PWA) for managing susu customers, deposits, withdrawals,
reports, staff and SMS. The frontend is in `Area Supa Ventres/`, the backend
(Firebase Cloud Functions) is in `functions/`, and the database rules are in
`firestore.rules`.

## How it is built

| Part | What it does |
|---|---|
| **Firebase Auth** | Staff sign-in (email + password, or phone code). |
| **Cloud Firestore** | Customers, transactions, settings, SMS log, audit log. Browsers can only *read* what their role allows. |
| **Cloud Functions** | Every write that matters: deposits/withdrawals, customer create/edit/delete, staff & roles, SMS, buying units, Cloudinary signing. Each one checks the caller's role on the server. |
| **Cloudinary** | Customer profile photos (signed uploads; the secret stays on the server). |
| **ProfJero Connect** | SMS sending, wallet balance and buying SMS units. |

## Security model

- **Money only moves on the server.** `recordTransaction` checks the role, validates the amount (2 decimals, max GH₵1,000,000), refuses overdrafts and computes balances in pesewas inside a Firestore transaction. Browsers cannot write balances or transactions (`firestore.rules`).
- **No double posting.** Each deposit/withdrawal submission carries a one-off request ID that becomes the transaction ID. A retry after a dropped connection returns the original transaction instead of recording it again.
- **Roles live on the server** (`users/{uid}`, written only by functions). Someone who creates a Firebase account on their own gets no access.
- **Re-enter password** for destructive or privileged actions (deleting customers, staff changes, data upgrade).
- **Audit log** of registrations, edits, deletions, staff and role changes, SMS sends, top-ups, large withdrawals and settings changes.
- **Auto sign-out** after inactivity (default 15 minutes, set in Settings). New staff must change their temporary password at first sign-in.
- **Suspending** a staff member cuts them off immediately: sessions are revoked and the rules check status on every read.
- **Strict Content-Security-Policy** and security headers (`firebase.json`); no inline scripts.
- The ProfJero secret key and the Cloudinary secret are stored in Google Secret Manager, never in the browser.

## Roles

| | Owner | Administrator | Manager | Collector | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|
| View customers & transactions | ✔ | ✔ | ✔ | ✔ | ✔ |
| Register customers | ✔ | ✔ | ✔ | ✔ | |
| Edit customers & photos | ✔ | ✔ | ✔ | | |
| Record deposits / withdrawals | ✔ | ✔ | ✔ | ✔ | |
| Reports | ✔ | ✔ | ✔ | | ✔ |
| Send SMS to chosen customers | ✔ | ✔ | ✔ | | |
| SMS to all / a branch, templates | ✔ | ✔ | | | |
| Buy SMS units | ✔ | ✔ | | | |
| **Permanently delete customers** | ✔ | ✔ | | | |
| Add staff & assign roles | ✔ (all) | ✔ (below admin) | | | |
| Settings, audit log | ✔ | ✔ | | | |

The roles are defined once in `functions/src/roles.js`. A copy lives at `Area Supa Ventres/js/lib/roles.js`, and a test keeps the two identical and checks `firestore.rules` against them.

## Features

- **Customer list:** shows every customer, sorted A→Z by default. You can sort by name (A–Z or Z–A), customer ID, registration date or balance, and filter by branch. The device remembers the chosen sort. Search matches any part of a name, Tel 1 or Tel 2, or a customer ID.
- **Customer IDs:** `ASV-10001`, `ASV-10002`, … assigned atomically on the server.
- **Bio data:**
  - Names (first, middle, surname), gender, date of birth, marital status, occupation, nationality and hometown.
  - Residential and digital address, ID type and number, email.
  - **Tel 1, Tel 2, Branch, Date of registration**.
  - Next of kin (with relationship and phone), notes and SMS opt-out.
  - A **profile photo**, taken with the camera or picked from the gallery, resized on the phone and stored on Cloudinary.
- **Permanent delete (Owner/Admin):** the customer page explains the risk before anything is deleted. To go ahead you must:
  - type the customer ID,
  - give a reason,
  - confirm any remaining balance was settled,
  - enter your password.

  The profile, photo and all transactions are then erased. A summary is kept in the audit log.
- **SMS** (`sms.html`):
  - Automatic deposit, withdrawal and welcome alerts. They can be switched off for a single transaction.
  - Bulk or individual messages, sent now or scheduled, with a cost check before sending.
  - Birthday wishes and holiday greetings (Christmas, New Year, Independence Day, or your own), sent automatically at 8:00 AM.
  - Personalised fields:
    - `{first_name}`, `{last_name}`, `{full_name}`, `{customer_id}`, `{phone}`, `{tel2}`, `{branch}`, `{balance}`, `{registration_date}`, `{company}`.
    - Alerts can also use `{amount}`, `{transaction_type}`, `{transaction_date}`, `{transaction_ref}` and `{payment_method}`.
    - Fallbacks work too, e.g. `{first_name|Customer}`.
  - History with delivery status.
  - **Buy units** from ProfJero Connect: a package or a custom amount, paid by mobile money or card.
- **Staff & roles** (`staff.html`): add sub-admins and staff, change roles, suspend, reset passwords and remove staff.
- **Settings** (`settings.html`): business name, branches, auto sign-out and a one-time data upgrade.

## Speed

- **Compiled CSS:** Tailwind is built ahead of time into `assets/app.css` (~40 KB). Previously the Play CDN compiler, about 400 KB of JavaScript, rebuilt the CSS on every page load.
- **Faster login:** the login screen no longer waits a fixed 2.4 s. It appears as soon as the sign-in state is known.
- **Dashboard:** reads two small totals documents in parallel. The server keeps them up to date, so the page no longer scans transactions one query after another.
- **Customer list:** loads 30 at a time (more as you scroll), with small Cloudinary thumbnails.
- **Smaller logos:** compressed from 270 KB to 43 KB.
- **Service worker:** caches the app shell, so repeat visits open instantly and the app can be installed on a phone's home screen.

## First-time setup

You need the Firebase **Blaze** (pay-as-you-go) plan, because Cloud Functions require it. Typical usage for one business stays within the free allowance.

```bash
npm install -g firebase-tools
firebase login
npm install                      # Tailwind build tools
(cd functions && npm install)
```

1. **Cloudinary:** create a free account and note the *cloud name*, *API key* and *API secret*.
2. **ProfJero Connect:** create an account, request a Sender ID, and create a **secret API key** (`pk_live_…`) under *API & Integrations*.
3. Configure the functions:
   ```bash
   cp functions/.env.example functions/.env      # then edit APP_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY
   firebase functions:secrets:set PROFJERO_API_KEY
   firebase functions:secrets:set CLOUDINARY_API_SECRET
   ```
4. Deploy everything:
   ```bash
   npm run deploy        # builds CSS, stamps the service worker, firebase deploy
   ```
5. **Make yourself the Owner** (once). Download a service-account key from Firebase console → Project settings → Service accounts, then run:
   ```bash
   cd functions
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/bootstrap-owner.mjs you@example.com "Your Name"
   ```
   This suspends every other existing profile, because the old app let any browser set its own role. Re-activate real staff from the **Staff** page.
6. Sign in and open **Settings**. Add your branches, then run **Data upgrade** once. It prepares existing customers for sorting, search and birthday messages. It can also renumber them to `ASV-10001…`; their old numbers stay searchable.
7. Open **SMS → Automatic**, choose your Sender ID, and turn on the alerts and greetings you want.
8. Delete the service-account key file.

### Optional hardening
- Turn on **Firebase App Check** for the web app, then set `ENFORCE_APP_CHECK=true` in `functions/.env`.
- In Firebase Auth settings, enable email enumeration protection. Staff accounts are created only by the server.

## Local development

```bash
npm run watch:css                          # rebuild CSS while editing
firebase emulators:start                   # Auth, Firestore, Functions, Hosting
# open http://localhost:5002 (connects to the emulators automatically)
(cd functions && npm test)                 # unit tests
```

For local function secrets, create `functions/.secret.local` (`PROFJERO_API_KEY=…`, `CLOUDINARY_API_SECRET=…`) and `functions/.env.local`. Both are git-ignored.
