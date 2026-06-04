# Settings Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings tab/view with an Account section that lets claimed users navigate to the recovery phrase flow, and prompts anonymous users to claim their account.

**Architecture:** Follow the existing `navigate()` / `data-tab-view` / `renders.*` pattern exactly. Add `view-settings` HTML, register `renders.settings`, add the tab to both the bottom tab bar and top nav, and wire a "Generate new recovery phrase" button that shows a confirmation dialog before navigating to the existing claim view.

**Tech Stack:** Vanilla JS, HTML, CSS — no build step, no dependencies.

---

## Files

- **Modify:** `index.html` — add `view-settings` div, add Settings tab to bottom tab bar and top nav
- **Modify:** `app.js` — add `TAB_VIEWS.settings`, `renders.settings`, and the btn-settings-claim click handler
- **Modify:** `style.css` — add `#view-settings` header hide rule on desktop (matching events/library pattern)

---

### Task 1: Add the Settings view HTML

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the `view-settings` div**

In `index.html`, after the `view-product-form` closing `</div>` (line ~169) and before the product sheet `<!-- ── Product / fuel picker sheet -->`, add:

```html
<!-- ── Settings view ──────────────────────────────────────────── -->
<div id="view-settings" class="view">
  <header class="app-header">
    <h1>Settings</h1>
  </header>
  <div class="view-body">
    <div id="settings-account-section"></div>
  </div>
</div>
```

- [ ] **Step 2: Add Settings to the bottom tab bar**

In `index.html`, find the `<nav class="tab-bar" id="tab-bar">` block and add the Settings button:

```html
<nav class="tab-bar" id="tab-bar">
  <button class="tab-btn active" data-tab-view="events">Events</button>
  <button class="tab-btn" data-tab-view="library">Library</button>
  <button class="tab-btn" data-tab-view="settings">Settings</button>
</nav>
```

- [ ] **Step 3: Add Settings to the top nav**

In `index.html`, find the `.top-nav-links` div and add the Settings link before `btn-new-event-nav`:

```html
<div class="top-nav-links">
  <button class="tab-btn top-nav-link" data-tab-view="events">Events</button>
  <button class="tab-btn top-nav-link" data-tab-view="library">Library</button>
  <button class="tab-btn top-nav-link" data-tab-view="settings">Settings</button>
  <button id="btn-new-event-nav" class="top-nav-cta">+ New Event</button>
</div>
```

- [ ] **Step 4: Open the app in a browser and verify**

Open `index.html` directly in a browser (or via a local server). You should see three tabs in the bottom nav: Events, Library, Settings. Tapping Settings should show a blank white view (no content yet — that's expected). The top nav on desktop should also show a Settings link. No console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add settings view HTML and nav tabs"
```

---

### Task 2: Register `settings` in the router and add desktop CSS

**Files:**
- Modify: `app.js`
- Modify: `style.css`

- [ ] **Step 1: Add `settings` to `TAB_VIEWS`**

In `app.js`, find line 121:
```js
var TAB_VIEWS = { events: true, library: true };
```
Change to:
```js
var TAB_VIEWS = { events: true, library: true, settings: true };
```

- [ ] **Step 2: Add `renders.settings` placeholder**

In `app.js`, directly after `renders.library = renderLibrary;` (around line 1403), add:

```js
renders.settings = renderSettings;
```

Then add the `renderSettings` function just above that line:

```js
function renderSettings() {
  var isAnonymous = localStorage.getItem('fuelPlanner.isAnonymous') === 'true';
  var section = $('settings-account-section');
  if (!section) return;

  if (isAnonymous) {
    section.innerHTML =
      '<div class="form-card" style="margin-top:16px">' +
        '<p style="margin:0 0 12px">Claim your account to protect your data and get a recovery phrase for linking this account on another device.</p>' +
        '<button id="btn-settings-go-claim" class="btn-primary">Claim account</button>' +
      '</div>';
    on($('btn-settings-go-claim'), 'click', function () {
      navigate('claim');
    });
  } else {
    section.innerHTML =
      '<div class="form-card" style="margin-top:16px">' +
        '<p style="margin:0 0 4px;font-weight:600">Recovery phrase</p>' +
        '<p style="margin:0 0 12px;color:var(--text-secondary);font-size:14px">Generate a new recovery phrase to link your account on another device. You\'ll need to save the new phrase — your old one will stop working.</p>' +
        '<button id="btn-settings-new-phrase" class="btn-secondary">Generate new recovery phrase</button>' +
      '</div>';
    on($('btn-settings-new-phrase'), 'click', function () {
      if (!confirm('This will replace your current recovery phrase. Your old phrase will stop working immediately. Make sure you\'re ready to save the new one before continuing.')) return;
      navigate('claim');
    });
  }
}
```

- [ ] **Step 3: Hide the settings header on desktop**

In `style.css`, find the block that hides Events and Library headers on desktop (around line 734):

```css
#view-events .app-header,
#view-library .app-header { display: none; }
```

Change to:

```css
#view-events .app-header,
#view-library .app-header,
#view-settings .app-header { display: none; }
```

- [ ] **Step 4: Open the app and verify both states**

Test **claimed user:** open the app as a claimed user (localStorage `fuelPlanner.isAnonymous` = `'false'`). Navigate to Settings. You should see a "Recovery phrase" card with a "Generate new recovery phrase" button. Click it — a browser confirm dialog should appear. Cancel → nothing happens. OK → navigates to the claim view (phrase shown, checkbox, Save button).

Test **anonymous user:** in DevTools, set `localStorage.setItem('fuelPlanner.isAnonymous', 'true')` and reload. Navigate to Settings. You should see the "Claim account" card. Click "Claim account" → navigates to the claim view.

Verify no console errors in either case.

- [ ] **Step 5: Commit**

```bash
git add app.js style.css
git commit -m "feat: wire settings render with account section and recovery phrase flow"
```

---

### Task 3: Handle back-navigation from claim when entered via Settings

**Files:**
- Modify: `app.js`

Currently the claim view's back button always navigates to `landing`. When the user reaches claim via Settings, the back button should return to Settings instead.

- [ ] **Step 1: Track the claim entry point**

In `app.js`, find the `btn-claim-back` handler (search for `btn-claim-back`). It currently calls `navigate('landing')`.

Replace the existing handler registration:
```js
on($('btn-claim-back'), 'click', function () { navigate('landing'); });
```
With:
```js
on($('btn-claim-back'), 'click', function () {
  navigate(state.claimReturnView || 'landing');
});
```

- [ ] **Step 2: Set `claimReturnView` when navigating to claim from Settings**

In the `renderSettings` function (added in Task 2), update both navigation calls to set the return view:

For the anonymous user button:
```js
on($('btn-settings-go-claim'), 'click', function () {
  state.claimReturnView = 'settings';
  navigate('claim');
});
```

For the claimed user "Generate new recovery phrase" button:
```js
on($('btn-settings-new-phrase'), 'click', function () {
  if (!confirm('This will replace your current recovery phrase. Your old phrase will stop working immediately. Make sure you\'re ready to save the new one before continuing.')) return;
  state.claimReturnView = 'settings';
  navigate('claim');
});
```

Also update `renders.claim` to clear `claimReturnView` when reached from the landing flow. The existing `btn-save-claim` already calls `navigate('events')` on success — that is correct and unchanged. The back button already reads `state.claimReturnView` now, so no further changes needed there.

- [ ] **Step 3: Clear `claimReturnView` when entering claim from the landing flow**

Find the existing landing handler that calls `navigate('claim')` — it's on `$('claim-indicator')` and any other entry points. After each `navigate('claim')` that is NOT from Settings, set `state.claimReturnView = null`. There is one such entry point: the claim indicator click. Find it (search for `navigate('claim')`) and for each non-Settings call add `state.claimReturnView = null;` before it:

```js
on($('claim-indicator'), 'click', function (e) {
  var dismissBtn = $('btn-dismiss-indicator');
  if (dismissBtn && dismissBtn.contains(e.target)) return;
  state.claimReturnView = null;
  navigate('claim');
});
```

- [ ] **Step 4: Verify back-navigation behaviour**

**From Settings (claimed):** Settings → Generate new recovery phrase → confirm → claim view → tap back → should land on Settings.

**From Settings (anonymous):** Settings → Claim account → claim view → tap back → should land on Settings.

**From claim indicator:** Tap the claim indicator banner → claim view → tap back → should land on Landing (not Settings).

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: return to settings from claim view when entered via settings"
```
