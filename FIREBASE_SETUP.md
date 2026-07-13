# Firebase auth + cloud sync — setup guide

This app now has **optional** Firebase sign-in and cloud sync layered on
top of the existing offline-first storage. Nothing is required to keep
using the app exactly as before — if you never create a Firebase
project, the "Sign in" button simply doesn't appear.

## How it behaves

- **No sign-in required.** All data still lives locally (localStorage +
  IndexedDB, exactly as before). Nothing is gated behind a login.
- **Sign in is optional**, via email/password or Google, using a
  "Sign in" button in the header.
- **Two roles**, stored on each user's `users/{uid}` Firestore profile:
  - `advisor` (default for every new account) — manages the students
    assigned to them.
  - `master` — read-only view of *every* advisor's students and
    reports. There's no self-service way to become "master"; you
    promote someone by hand in the Firestore console (see below). This
    is intentional — it's a real security boundary.
- **Sync is manual, not automatic.** An advisor presses **"Sync to
  cloud"** to push their current local roster/grades/plans up, and
  **"Load from cloud"** to pull their own previously-synced data down
  (e.g. on a new computer). Local autosave to IndexedDB/localStorage is
  unaffected and keeps happening on every change, exactly as before.
- A student becomes "assigned" to an advisor the first time that
  advisor syncs them. After that, syncing again only touches students
  already owned by that advisor (or brand-new ones) — advisors can't
  silently overwrite another advisor's students.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com/> and click **Add project**.
2. Give it a name, finish the wizard (Google Analytics is optional, not
   needed here).

## 2. Register a Web app

1. In the new project, click the **`</>`** (web) icon to add a web app.
2. Give it a nickname (no hosting setup needed).
3. Firebase shows you a `firebaseConfig` object — copy those values.

## 3. Fill in your env file

Copy `.env.example` to `.env.local` (already git-ignored) and paste in
the values from step 2:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Restart `npm run dev` after adding these — Vite only reads `.env*`
files at startup.

## 4. Turn on sign-in methods

Firebase console → **Build → Authentication → Sign-in method**:

- Enable **Email/Password**.
- Enable **Google**. You'll need to set a support email; the default
  settings are fine for development. For Google sign-in to work outside
  `localhost`, add your production domain under **Authentication →
  Settings → Authorized domains**.

## 5. Turn on Firestore

Firebase console → **Build → Firestore Database → Create database**.
Pick a region close to your users, start in **production mode** (the
rules below cover it — don't leave it in fully-open test mode).

## 6. Publish the security rules

Open **Firestore → Rules** in the console and paste in the contents of
`firestore.rules` (included in this project). This enforces:

- An advisor can only read/write students they own.
- A `master`-role account can read every student.
- Nobody can grant themselves the `master` role from the client.

## 7. Promote someone to "master"

There's no in-app button for this on purpose. After that person has
signed in at least once (so their `users/{uid}` doc exists):

1. Firebase console → **Firestore Database → Data**.
2. Open `users/{their uid}` (find the uid under **Authentication →
   Users** if you don't have it handy).
3. Edit the `role` field from `"advisor"` to `"master"`.
4. They'll see the **"Master report"** button next time they sign in
   (or refresh).

## Notes / things you may want to adjust later

- **Catalog is shared**, not per-advisor (`shared/catalog` doc) — any
  signed-in user can currently overwrite it. If you'd rather only
  `master` manage the catalog, tighten the `shared/catalog` rule in
  `firestore.rules`.
- **Deleting students from the cloud** isn't wired up yet — the rules
  only allow create/update, not delete, so `clearRoster()` /
  `deleteRosterEntries()` won't remove anything already synced. Ask if
  you want that added.
- **Conflicts**: "Sync to cloud" overwrites the cloud copy of your own
  students with whatever's in your browser right now — there's no
  merge/diff UI. If two advisors' browsers somehow synced the same
  studentId, the second push wins (for their own students only; a
  student already owned by another advisor is skipped, not overwritten).
