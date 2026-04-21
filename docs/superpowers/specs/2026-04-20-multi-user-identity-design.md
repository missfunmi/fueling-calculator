# Multi-User Identity — Design Spec
_2026-04-20_

## Overview

Add lightweight multi-user support without email, OAuth, or a traditional auth flow. Each user is identified by a name + passphrase combination that deterministically derives a stable UUID. The same inputs on any device produce the same UUID and the same events appear. No passphrase is stored anywhere.

The immediate goal is to let a friend use the site independently, with their own events and product library, without seeing the owner's data.

---

## Identity Model

### Derivation

```
userId = sha256(name.toLowerCase().trim() + ":" + passphrase.trim())
         → first 32 hex chars formatted as UUID (8-4-4-4-12)
```

The name component meaningfully reduces guessability — an attacker must know both the name and the passphrase to derive another user's UUID. A passphrase alone is not enough.

### Storage

On setup, two values are written to localStorage:

| Key | Value |
|---|---|
| `fuelPlanner.userId` | Derived UUID |
| `fuelPlanner.displayName` | Raw display name (for personalisation only) |

The passphrase is never stored anywhere — not in the browser, not in the database.

On return visits, `fuelPlanner.userId` is present in localStorage. The app reads it directly and skips both the landing page and setup screen.

On a new device, the user enters the same name and passphrase, derives the same UUID, and their events reappear.

### Security properties

- Name + passphrase together form the secret; neither alone is sufficient.
- No server-side secret storage.
- No session tokens or cookies.
- If a user forgets their passphrase, access cannot be recovered programmatically (see Recovery below).

---

## Database

### `users` table

The `users` table already existed with only an `id UUID PRIMARY KEY` column. Two columns were added:

```sql
ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN created_at   TIMESTAMPTZ DEFAULT now();
-- Backfill existing row, then tighten the default:
UPDATE users SET display_name = 'Funmi' WHERE display_name = '';
ALTER TABLE users ALTER COLUMN display_name DROP DEFAULT;
```

Upserted on every setup. If the same user sets up on a second device with a slightly different display name, the upsert updates `display_name` to the latest value. `created_at` is set only on first insert (`ON CONFLICT DO UPDATE SET display_name = EXCLUDED.display_name`).

No foreign keys to `events` or `products` — the UUID is the implicit link via `user_id`.

RLS policy required (anon key has no JWT, so `auth.uid()` is always null):

```sql
CREATE POLICY "allow anon all" ON users FOR ALL TO anon USING (true) WITH CHECK (true);
```

### Existing tables

`events`, `products`, `segments`, and `items` already have the necessary columns. However, all four tables had RLS policies written against the old hardcoded UUID. Those policies must be replaced with permissive anon policies (data isolation is enforced by the `user_id=eq.UUID` filter sent in every query):

```sql
-- Drop old hardcoded-UUID policies, then:
CREATE POLICY "anon all" ON events   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon all" ON products FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon all" ON segments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon all" ON items    FOR ALL TO anon USING (true) WITH CHECK (true);
```

The `save_event` Postgres function (used by `saveEvent` in `data.js`) also had a hardcoded UUID guard that must be replaced with a `users` table existence check:

```sql
-- Replace:
IF (event_data->>'user_id')::UUID != '33d5e92b-...'::UUID THEN RAISE EXCEPTION 'unauthorized'; END IF;
-- With:
IF NOT EXISTS (SELECT 1 FROM users WHERE id = (event_data->>'user_id')::UUID) THEN
  RAISE EXCEPTION 'unauthorized';
END IF;
```

This allows any registered user to write events while still rejecting arbitrary UUIDs.

---

## First-Visit Flow

```
First visit (no localStorage)
  └── Landing page
        └── "Get started" → Setup screen
              └── Submit → derive UUID → write localStorage → upsert users → load app

Return visit (localStorage has userId)
  └── Load app directly
```

### Landing page

A static view rendered inside the existing app shell. Shown only when `fuelPlanner.userId` is absent from localStorage.

Content:
- App name
- One-line description ("Plan your race nutrition. Track what you actually ate.")
- Short feature list (3–4 bullets: plan segments, track actuals, log your library)
- "Get started" button → navigates to setup screen

No logic. Placeholder copy to be replaced when a real marketing page is designed.

### Setup screen

Title: "Set up your space" (not "Create your account" — intentionally avoids account/auth framing).

Two fields:
- "What should we call you?" — display name, required, non-empty
- "Your phrase" — passphrase, required, non-empty, shown as plain text by default with a hide/show toggle

Helper text below passphrase: "A few words you'll remember — type the same phrase on any device to get back to your data."

On submit:
1. Validate both fields non-empty (passphrase whitespace-only is also rejected)
2. Derive UUID via SHA-256
3. Write `fuelPlanner.userId` and `fuelPlanner.displayName` to localStorage
4. Upsert to `users` table: `INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`
5. Reload page via `window.location.reload()` — required so `data.js` picks up the new `USER_ID` at module-load time

No confirmation field for the passphrase. The user is responsible for remembering it — the UI makes this clear.

---

## Data Layer (`data.js`)

### `USER_ID` constant removed

Replace the hardcoded constant:
```js
// Before
var USER_ID = '33d5e92b-360a-45b7-a423-656f14e67b98';

// After
var USER_ID = localStorage.getItem('fuelPlanner.userId');
```

`USER_ID` is read once at module load. All existing queries that filter by `user_id=eq.USER_ID` continue to work unchanged.

### New: `saveUser(id, displayName)`

```js
async function saveUser(id, displayName) {
  await supabaseRequest(
    'POST',
    'users',
    { id: id, display_name: displayName },
    'resolution=merge-duplicates'
  );
}
```

Called once during setup, after UUID derivation.

### New: `deriveUserId(name, passphrase)`

```js
async function deriveUserId(name, passphrase) {
  var input = name.toLowerCase().trim() + ':' + passphrase.trim();
  var encoded = new TextEncoder().encode(input);
  var hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  var hex = Array.from(new Uint8Array(hashBuffer))
    .map(function (b) { return b.toString(16).padStart(2, '0'); })
    .join('');
  // Format as UUID: 8-4-4-4-12
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' +
         hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20, 32);
}
```

`crypto.subtle` is available in all modern browsers and on HTTPS (Netlify deploys qualify).

---

## App Layer (`app.js`)

### Init sequence change

Before rendering any view, `init()` checks localStorage:

```js
if (!localStorage.getItem('fuelPlanner.userId')) {
  navigate('landing');
  return;
}
// normal init continues
```

### New views

Two new views added to the existing view system:
- `view-landing` — static HTML, "Get started" button navigates to `view-setup`
- `view-setup` — form with name + passphrase fields; on submit derives UUID, saves to localStorage + DB, navigates to `view-events`

Both views hide the tab bar (same pattern as `detail` and `create` views).

---

## Migration (Owner Only, One-Time)

After the owner completes setup on their device, they will have a new derived UUID. Their existing events and products are stored under the old hardcoded UUID `33d5e92b-360a-45b7-a423-656f14e67b98`.

Run in the Supabase SQL editor, replacing `<new-uuid>` with the derived UUID shown in `localStorage.getItem('fuelPlanner.userId')` from the browser console:

```sql
UPDATE events   SET user_id = '<new-uuid>' WHERE user_id = '33d5e92b-360a-45b7-a423-656f14e67b98';
UPDATE products SET user_id = '<new-uuid>' WHERE user_id = '33d5e92b-360a-45b7-a423-656f14e67b98';
UPDATE users    SET id = '<new-uuid>', display_name = 'Funmi'
  WHERE id = '33d5e92b-360a-45b7-a423-656f14e67b98';
```

`UPDATE users` (not `INSERT`) because the `users` table already had a row for the old hardcoded UUID. Inserting would leave the old row as an orphan.

---

## Recovery (Manual Admin Process)

If a user forgets their passphrase:

1. Run `SELECT id, display_name FROM users ORDER BY created_at` in Supabase to identify their UUID by display name.
2. Their events and products can be viewed/exported from Supabase directly using their UUID.
3. The user sets up a new name + passphrase on their device (producing a new UUID).
4. An admin manually reassigns their rows: `UPDATE events SET user_id = '<new-uuid>' WHERE user_id = '<old-uuid>'` and same for products, then updates the `users` row.

This is intentionally a manual admin process for now. A self-service export/import flow is a future feature.

---

## Future Compatibility

**Share links (Option B):** No design changes required. Events are already keyed by `user_id`. A share token would be a new column on `events` with a separate lookup endpoint — completely additive.

**Export/import:** The `users` table provides a clean index. Export queries `events` and `products` by `user_id`. Import inserts rows under a new `user_id`. No structural changes needed.

**Landing page copy:** The landing page view is a placeholder. When a real marketing page is designed, only the HTML content changes — no logic changes.

---

## Files Changed

| File | Change |
|---|---|
| `index.html` | Add `view-landing` and `view-setup` view divs |
| `app.js` | Init check; `navigate('landing')` / `navigate('setup')` flows; setup form handler calling `deriveUserId` + `saveUser` |
| `data.js` | Remove hardcoded `USER_ID`; add `deriveUserId`, `saveUser`; export both |
| `style.css` | Landing and setup screen styles |
| Supabase | `ALTER TABLE users` (add `display_name`, `created_at`); RLS policies on all tables; update `save_event` function; owner migration SQL |

---

## Out of Scope

- Password strength enforcement
- Passphrase confirmation field
- Logout / account switching UI
- Email or SMS verification
- OAuth or third-party auth
- Self-service passphrase recovery
- Export/import UI
- Share links between users
