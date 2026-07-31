# Personal Task Tracker

A task tracker built around how you actually think about work: every task
has a **project** (what it's for) and a **type** (what kind of work it is —
Email follow-up, Legal/contracts, Creative writing, etc.), so you can view
your list by project or by type for time-blocking. Synced across your
devices via Firebase, hosted for free on GitHub Pages.

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

## How it works

- **Auth**: Google sign-in via Firebase Auth — this is what lets your data
  follow you between your laptop, phone, etc.
- **Storage**: Firestore, under `users/{your-uid}/tasks/{taskId}`, synced
  live — edits on one device appear on others within a second or two.
- **Adding a task**: type a title, project, and type in the top bar (both
  required — existing types show up as one-click tags so your labels stay
  consistent) and press **Add**. A popup opens with everything else —
  priority, energy, deadline, estimate, context, repeats — visible at once,
  no scrolling. "Create task" stays disabled until title/project/type are
  filled.
- **Editing a task**: click any task row to expand it in place and edit any
  field directly.
- **Recurring tasks**: marking a repeating task done automatically creates
  the next occurrence, rolled forward by the chosen interval.
- **Views**:
  - **List** — grouped by Overdue / Today / Upcoming / No date
  - **Board** — To do / Done, side by side
  - **Project** — grouped by project
  - **Type** — grouped by type, for time-blocking similar work together
- **Filters**: search, priority, energy, and context, plus a "hide done"
  toggle — all apply across every view.
- **Cost**: Firebase's free "Spark" tier comfortably covers personal use —
  there's no billing setup required to get started.

## Task fields

| Field | Notes |
|---|---|
| Title | required |
| Project | required — free text, autocompletes from past entries |
| Type | required — free text, shown as one-click tags from past entries |
| Priority | Low / Medium / High |
| Status | To do / Done |
| Deadline | optional date |
| Estimate | optional, in minutes |
| Energy | Low / Medium / High |
| Context | optional free text, e.g. Desk, Calls, Errands, Anywhere |
| Repeats | None / Daily / Weekly / Monthly |

## Customizing

- Visual styling uses Tailwind utility classes loaded via CDN in
  `index.html` — edit classes directly in `app.js` and `index.html`.
  `styles.css` only holds the few things Tailwind's CDN build can't do
  (focus rings, reduced-motion).
- Add more recurrence options in the `nextDueDate()` function in `app.js`.
- Everything is vanilla JS with no framework or bundler — edit directly and
  refresh the page to see changes.
