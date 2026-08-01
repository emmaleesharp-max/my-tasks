# Ledger — a personal task tracker

A task tracker built around how you actually think about work: every task
has a **project** (what it's for, free text — e.g. "Q3 launch," "Client X")
and a **type** (what kind of work it is, from a fixed list: Email, Meeting,
Finance, Errand, Admin), so you can view your list by project or by type
for time-blocking. Synced across your devices via Firebase, hosted for free
on GitHub Pages.

No build step — plain HTML/CSS/JS (styled with the Tailwind CDN build), so
you can open `index.html` directly or drop it straight into GitHub Pages.

## 1. Create a Firebase project (free)

1. Go to https://console.firebase.google.com and click **Add project**.
   Give it any name (e.g. "my-ledger") and finish the wizard.
2. In the left sidebar: **Build → Authentication → Get started**.
   Under "Sign-in method," enable **Google**.
3. In the left sidebar: **Build → Firestore Database → Create database**.
   Start in **production mode**, pick any region.
4. Once created, go to the **Rules** tab and replace the contents with this,
   then click **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/tasks/{taskId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

   This ensures only you can ever read or write your own tasks.

5. Go to **Project settings** (gear icon, top left) → scroll to **Your apps**
   → click the **</>** (web) icon → register an app (any nickname, no need
   for Firebase Hosting) → copy the `firebaseConfig` object it shows you.

## 2. Add your config

Open `firebase-config.js` in this folder and paste your values in, e.g.:

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "my-ledger-12345.firebaseapp.com",
  projectId: "my-ledger-12345",
  storageBucket: "my-ledger-12345.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## 3. Authorize your GitHub Pages domain

Firebase only allows sign-in from domains you've approved.

1. In Firebase Console: **Authentication → Settings → Authorized domains**.
2. Click **Add domain** and add `<your-github-username>.github.io`
   (you'll know the exact address once you finish step 4 below).

## 4. Push to GitHub and turn on Pages

```bash
cd task-tracker
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Source: Deploy
from a branch → Branch: main / (root)**. Save. Your app will be live in a
minute or two at:

```
https://<your-username>.github.io/<repo-name>/
```

## 5. (Optional) Email → task import

The `email-import/` folder sets up a free Apps Script that turns emails
forwarded to a Gmail "+" alias into tasks automatically, using this same
schema. See `email-import/README.md` for setup — it's independent of the
steps above and can be added any time.

## Installing on your phone

The app has a web manifest and icons, so it installs like a real app:

- **Android (Chrome)**: open your GitHub Pages URL → tap **⋮** → **Install
  app** (or "Add to Home screen"). If that option doesn't show up, this is
  a known intermittent Chrome/Android bug unrelated to this app — try
  reloading the page once or twice, or check for a Chrome update.
- **iPhone (Safari)**: open the URL → tap the Share icon → **Add to Home
  Screen**. Note: iOS only supports this from Safari, not Chrome, since
  Apple restricts other browsers from offering it.

Either way, it opens full-screen with its own icon, no browser bar.

## 6. (Optional) Calendar view setup

The **Calendar** tab shows a day at a time — your real Google Calendar
events alongside any tasks due that day — so you can plan your day around
meetings. It's read-only: nothing in the app ever writes to your calendar.

This needs a separate Google Cloud credential (not the Firebase config from
step 2 — same underlying project, different piece).

1. Go to https://console.cloud.google.com and make sure the project
   selector (top left, next to "Google Cloud") shows your Firebase
   project — e.g. "my-tasks-dd101". If not, select it.
2. In the search bar at the top, search for **"Google Calendar API"** and
   open it, then click **Enable**.
3. Go to **APIs & Services → Credentials** (search "Credentials" if you
   don't see it in the sidebar).
4. Click **Create Credentials → OAuth client ID**.
   - If prompted to configure a consent screen first: choose **External**,
     fill in an app name (e.g. "My tasks") and your email for the required
     fields, save through the steps. On the "Test users" step, add your own
     Google email — this keeps it private to just you, no Google review
     needed.
5. Back on **Create OAuth client ID**: Application type → **Web
   application**. Under **Authorized JavaScript origins**, click **Add
   URI** and enter your GitHub Pages address *without* a trailing slash,
   e.g. `https://your-username.github.io`.
6. Click **Create**. Copy the **Client ID** shown (ends in
   `.apps.googleusercontent.com`).
7. Open `firebase-config.js` and paste it in as `GOOGLE_CALENDAR_CLIENT_ID`,
   replacing the placeholder.

Re-upload `firebase-config.js` to GitHub, then open the Calendar tab and
click **Connect Google Calendar** — the first time, Google will show a
warning that the app is unverified (expected, since you're the only test
user) — click through **Advanced → Go to [app name] (unsafe)** to proceed;
this is safe since it's your own app requesting read-only access to your
own calendar.

Note: the connection only lasts for your current browser session — you'll
need to click Connect again next time you open the app. That's a
deliberate simplicity trade-off, not a bug; a persistent connection would
need a more involved setup.

## How it works

- **Auth**: Google sign-in via Firebase Auth — this is what lets your data
  follow you between your laptop, phone, etc.
- **Storage**: Firestore, under `users/{your-uid}/tasks/{taskId}`, synced
  live — edits on one device appear on others within a second or two.
- **Adding a task**: type a title, project, and type in the top bar (both
  required — Project is a dropdown of everything you've used before, and
  you can type a new one to create it on the fly; Type is a fixed list of
  five options so it can't drift into dozens of one-off categories) and
  press **Add**. A popup opens with everything else — priority, energy,
  deadline, estimate, repeats, and a free-form details box — visible at
  once, no scrolling. "Create task" stays disabled until title/project/type
  are filled.
- **Editing a task**: click any task row to expand it in place and edit any
  field directly, including the title.
- **Importing tasks**: click **Import** next to Add. Paste a list of tasks
  — one per line. Plain lines (e.g. copied from Google Tasks or a Notion
  list) use the project/type you set in the dialog. If you instead copy two
  columns from a spreadsheet (Title, then Project, then optionally Type),
  each row uses its own values, so you can import a plan spanning several
  projects in one paste.
- **Renaming a project**: click **Rename project** (small link next to
  "Hide done"). Pick the project and type its new name — every task
  currently using it updates in one go, no need to edit them one by one.
- **Recurring tasks**: marking a repeating task done automatically creates
  the next occurrence, rolled forward by the chosen interval.
- **Views**:
  - **List** — grouped by Overdue / Today / Upcoming / No date
  - **Board** — To do / Done, side by side
  - **Project** — grouped by project
  - **Type** — grouped by type, for time-blocking similar work together
  - **Calendar** — one day at a time: your real Google Calendar events next
    to tasks due that day, with Previous/Today/Next navigation (optional,
    needs the setup in section 6 below). Supports multiple calendars — the
    first time you connect, you'll pick which of your calendars to include
    (none are shown by default), and can change that anytime via the
    "Calendars" link. Each calendar's events are color-coded to match its
    color in Google Calendar.
- **Filters**: search, priority, energy, project, and type, plus a "hide
  done" toggle — all apply across every view, so you can also isolate a
  single project while in List or Board view, not just the Project tab.
- **Cost**: Firebase's free "Spark" tier comfortably covers personal use —
  there's no billing setup required to get started.

## Task fields

| Field | Notes |
|---|---|
| Title | required, editable any time |
| Project | required — dropdown of past entries, or type a new one to create it |
| Type | required — fixed list: Email, Meeting, Finance, Errand, Admin |
| Priority | Low / Medium / High |
| Status | To do / Done |
| Deadline | optional date |
| Time | optional — if set, the task slots into the Calendar view's
  schedule alongside your meetings, sorted by time; without one, it stays
  in the plain "due this day" list |
| Estimate | optional — 5 / 15 / 30 / 60 minutes, or Over an hour |
| Energy | Low / Medium / High |
| Details | optional free-form notes |
| Repeats | None / Daily / Weekly / Monthly |

## Customizing

- Visual styling uses Tailwind utility classes loaded via CDN in
  `index.html` — edit classes directly in `app.js` and `index.html`.
  `styles.css` only holds the few things Tailwind's CDN build can't do
  (focus rings, reduced-motion).
- Add more recurrence options in the `nextDueDate()` function in `app.js`.
- To change the fixed Type list: update the `TYPES` constant near the top
  of `app.js` (this drives the row editor automatically), and also update
  the three static `<option>` lists in `index.html` — the quick-add bar,
  the New task modal, and the filter dropdown — to match.
- Everything is vanilla JS with no framework or bundler — edit directly and
  refresh the page to see changes.
