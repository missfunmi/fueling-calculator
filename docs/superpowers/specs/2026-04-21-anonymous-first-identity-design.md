# Anonymous-First Identity — Design Spec
_2026-04-21_

## Overview

Replace the setup-first identity model (name + passphrase required before first use) with an anonymous-first model. New visitors go straight into the app with a randomly assigned UUID. A subtle persistent indicator in the events list lets them generate and save a recovery phrase whenever they're ready — no upfront friction, no account framing.

The recovery phrase is app-generated (not user-chosen) to guarantee uniqueness. A `claims` table maps a hash of the phrase to the user's UUID, enabling cross-device recovery without derivation.

---

## Identity Model

### UUID assignment

On first "Get started" click, a random UUID is generated via `crypto.randomUUID()` and written to localStorage. This is the user's permanent identifier — it never changes, even after claiming.

```
fuelPlanner.userId      = crypto.randomUUID()
fuelPlanner.isAnonymous = 'true'
```

The `isAnonymous` flag drives claim banner visibility. It is set to `'false'` after a successful claim.

Existing users who went through the old setup-first flow have `fuelPlanner.userId` set but no `fuelPlanner.isAnonymous` key — the absence of that key is treated as claimed, so they never see the indicator.

### Phrase generation

The app generates a 4-word phrase from a built-in ~2000-word wordlist using `crypto.getRandomValues` (not `Math.random`). Example output: `maple river sunset bottle`.

Entropy: 2000⁴ ≈ 16 trillion combinations. Collision probability is negligible. Because the phrase is generated rather than user-chosen, no name component is needed.

### Claim storage

On claim, the phrase is hashed client-side:

```
phrase_hash = sha256(phrase.trim().toLowerCase())
```

The hash is stored in the `claims` table alongside the user's UUID. The raw phrase is never sent to or stored in the database.

On recovery (new device), the same hash is computed and looked up in `claims` to retrieve the UUID.

### getUserId()

`data.js` replaces the module-level `USER_ID` constant with a `getUserId()` function that reads `localStorage.getItem('fuelPlanner.userId')` on each call. This eliminates the page-reload-after-setup requirement and means UUID changes (claim, recovery) take effect immediately without reloading.

### localStorage keys

| Key | Value |
|---|---|
| `fuelPlanner.userId` | UUID (random, permanent) |
| `fuelPlanner.isAnonymous` | `'true'` until claimed, then `'false'` |

`fuelPlanner.displayName` is no longer written. Existing values in browsers are ignored and harmless.

### Security properties

- Raw phrase never stored anywhere — only its SHA-256 hash
- UUID is stable and never changes — no data migration on claim
- Uniqueness enforced by `PRIMARY KEY` on `phrase_hash` in DB
- `crypto.getRandomValues` provides cryptographically secure phrase generation
- Phrase alone is sufficient to recover; no name component needed or collected

---

## Database

### New table: `claims`

```sql
CREATE TABLE claims (
  phrase_hash  TEXT        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE POLICY "anon all" ON claims
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

### `users` table change

`display_name` is no longer collected or stored. Drop the column:

```sql
ALTER TABLE users DROP COLUMN display_name;
```

`saveUser` is simplified to only upsert `id`. The `users` table now exists solely to validate `user_id` in the `save_event` function.

### Existing tables

`events`, `products`, `segments`, `items` — no changes.

---

## Flows

### First-visit flow

```
New visitor (no localStorage)
  └── Landing page (two buttons)
        ├── "Get started"
        │     └── Generate UUID → write localStorage → navigate to new event form
        └── "Take me to my existing data"
              └── Recovery screen
```

### Return visit

```
Returning visitor (localStorage has userId)
  └── init() skips landing → navigate to events list
        ├── isAnonymous = 'true' → show claim indicator in header
        └── isAnonymous absent/'false' → no indicator
```

### Claim flow

```
Claim indicator tapped
  └── Claim screen
        ├── 4-word phrase displayed (generated on screen open)
        ├── Regenerate button → new phrase
        ├── Copy button
        ├── Checkbox: "I've saved my recovery phrase"
        └── "Save and continue" (enabled only when checkbox checked)
              └── sha256(phrase) → POST to claims → set isAnonymous='false' → navigate back to events
```

### Recovery flow (new device)

```
Landing → "Take me to my existing data"
  └── Recovery screen
        └── Phrase input → sha256(phrase) → GET claims?phrase_hash=eq.<hash>
              ├── Found → write user_id to localStorage → set isAnonymous='false' → reload → events list
              └── Not found → inline error: "No data found for this phrase. Check for typos and try again."
```

---

## Landing Page

Two buttons replace the single "Get started":

- **"Get started"** — primary button, generates UUID, navigates to new event form
- **"Take me to my existing data"** — secondary button, navigates to recovery screen

The setup screen (`view-setup`) is removed entirely. The landing page no longer leads to it.

---

## Claim Indicator

A subtle persistent element in the `view-events` header. Visible when `fuelPlanner.isAnonymous === 'true'`. Dismissable — tapping a close/dismiss icon hides it for the current session only; it reappears on next load until the user claims. (Dismissal is session-only, not persisted to localStorage, so it returns on next visit without being nagging — the user controls when they engage.)

Tapping the indicator (not the dismiss icon) opens the claim screen.

---

## Claim Screen (`view-claim`)

Full-screen view, no tab bar. Contains:

- Heading: "Save your recovery phrase"
- Subtext: "Write these words down or copy them. You'll need them to access your data on a new device."
- The 4-word phrase displayed prominently
- Regenerate button (generates a new phrase; only available before confirming)
- Copy button
- Checkbox: "I've saved my recovery phrase"
- "Save and continue" button — disabled until checkbox checked

On "Save and continue":
1. Compute `sha256(phrase.trim().toLowerCase())`
2. POST to `claims`: `{ phrase_hash, user_id: getUserId() }`
3. Set `fuelPlanner.isAnonymous = 'false'` in localStorage
4. Navigate back to events list — indicator no longer shows

---

## Recovery Screen (`view-recovery`)

Full-screen view, no tab bar. Reachable from the landing page "Take me to my existing data" button. Contains:

- Heading: "Enter your recovery phrase"
- Subtext: "Type the 4 words you saved when you set up your data."
- Text input for the phrase
- "Find my data" button

On submit:
1. Compute `sha256(phrase.trim().toLowerCase())`
2. GET `claims?phrase_hash=eq.<hash>&select=user_id`
3. **Found:** write `user_id` to `fuelPlanner.userId`, set `fuelPlanner.isAnonymous = 'false'`, reload
4. **Not found:** inline error below the input

---

## Data Layer (`data.js`)

### `getUserId()` replaces `USER_ID`

```js
// Before:
var USER_ID = localStorage.getItem(KEYS.userId);

// After:
function getUserId() {
  return localStorage.getItem(KEYS.userId);
}
```

All internal references to `USER_ID` are replaced with `getUserId()` calls. No reload required after UUID changes.

### New KEYS entries

```js
var KEYS = {
  recent:      'fuelPlanner.recentProducts',
  migrated:    'fuelPlanner.migrated',
  userId:      'fuelPlanner.userId',
  isAnonymous: 'fuelPlanner.isAnonymous'
};
```

`displayName` key removed.

### New functions

**`generatePhrase()`** — picks 4 words from a built-in wordlist using `crypto.getRandomValues`. Returns a space-separated string.

**`hashPhrase(phrase)`** — async, returns `sha256(phrase.trim().toLowerCase())` as a hex string using `crypto.subtle.digest`.

**`saveClaim(phraseHash)`** — POSTs `{ phrase_hash: phraseHash, user_id: getUserId() }` to the `claims` table.

**`lookupClaim(phraseHash)`** — GETs `claims?phrase_hash=eq.<phraseHash>&select=user_id`. Returns the UUID string if found, `null` if not.

### Removed functions

`deriveUserId` — removed entirely. `saveUser` — `display_name` parameter dropped; upserts only `id`.

---

## App Layer (`app.js`)

### Init sequence

```js
async function init() {
  // Landing + recovery handlers always registered
  on($('btn-landing-start'), 'click', function () {
    if (!localStorage.getItem('fuelPlanner.userId')) {
      localStorage.setItem('fuelPlanner.userId', Data.generateId());
      localStorage.setItem('fuelPlanner.isAnonymous', 'true');
    }
    navigate('create', { currentEventId: null });
  });

  on($('btn-existing-data'), 'click', function () {
    navigate('recovery');
  });

  // Identity check
  if (!localStorage.getItem('fuelPlanner.userId')) {
    navigate('landing');
    return;
  }

  // Normal app init: tab bar, migration, events
}
```

No page reload needed — `getUserId()` reads localStorage dynamically.

### Claim indicator

Rendered inside `view-events` header. Shown when `localStorage.getItem(KEYS.isAnonymous) === 'true'` and not dismissed this session. A module-level `_indicatorDismissed` flag tracks session dismissal.

### New views

- `view-claim` — claim screen (phrase display, regenerate, copy, checkbox, confirm)
- `view-recovery` — recovery screen (phrase input, find my data)

Both hide the tab bar and top nav (same pattern as `detail`, `create`).

---

## Migration (Owner Only, One-Time)

After deploying, the owner's existing UUID is in localStorage and works fine on their current device. However, the absence of `fuelPlanner.isAnonymous` is treated as claimed — the indicator will not appear automatically. To register a recovery phrase:

1. Open browser console on the current device and run:
   ```js
   localStorage.setItem('fuelPlanner.isAnonymous', 'true')
   ```
2. Reload — the claim indicator appears in the events list header
3. Tap it → claim screen → generate phrase → save it → confirm
4. The owner's UUID is now registered in `claims`; recovery on new devices works via the generated phrase

The old name + passphrase is no longer used for anything. `deriveUserId` is removed from the codebase.

---

## Files Changed

| File | Change |
|---|---|
| `data.js` | Replace `USER_ID` with `getUserId()`; add `generatePhrase`, `hashPhrase`, `saveClaim`, `lookupClaim`, wordlist; remove `deriveUserId`; drop `display_name` from `saveUser`; update KEYS |
| `tests/data.test.js` | Remove `deriveUserId` tests; add `generatePhrase`, `hashPhrase`, `saveClaim`, `lookupClaim` tests |
| `index.html` | Landing: add second button; remove `view-setup`; add `view-claim`, `view-recovery`; add indicator element in events header |
| `app.js` | Update `init()`; remove setup handlers; add claim/recovery/indicator handlers |
| `style.css` | Remove setup styles; add claim + recovery screen styles; add indicator styles |
| Supabase | `CREATE TABLE claims`; RLS policy; `ALTER TABLE users DROP COLUMN display_name`; owner migration |

---

## Out of Scope

- Email / SMS verification
- Passphrase strength enforcement
- Merging anonymous events into an existing claimed account
- Logout / account switching UI
- Export / import UI
- Self-service phrase reset (manual admin process, same as before)
