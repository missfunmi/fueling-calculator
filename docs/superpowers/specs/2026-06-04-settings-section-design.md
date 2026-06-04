# Settings Section — Design Spec
**Date:** 2026-06-04

## Overview

Add a Settings section to the app as a first-class navigation destination, starting with an Account subsection that exposes the recovery phrase flow. Designed to scale as future configurable options are added.

## Navigation

Settings is wired into the existing `navigate()` / `data-tab-view` system as a new `settings` view — identical to how `events` and `library` work.

- **Mobile:** a third tab is added to the bottom tab bar (`data-tab-view="settings"`)
- **Desktop:** a matching link is added to the top nav alongside Events and Library
- No changes to the active-tab or navigation logic are needed; both already handle arbitrary view names

## Settings View Structure

The `view-settings` div follows the same HTML skeleton as other views: a header bar with title and a `view-body` containing labelled sections.

**Initial sections:** one section — **Account**.

Future settings (units, notification preferences, etc.) are added as new `<section>` blocks in the same view body with no navigation changes.

## Account Section

### Claimed users
- A short confirmation that the account is claimed
- A **"Generate new recovery phrase"** button

### Anonymous users
- A message: *"Claim your account to protect your data"*
- A button that navigates to the existing claim flow

## Recovery Phrase Behaviour

The plain-text recovery phrase is never stored server-side — only a hash is saved in Supabase. There is nothing to display or unmask in Settings.

The "Generate new recovery phrase" button re-runs the existing claim flow, which:
1. Generates a new phrase
2. Presents it to the user
3. Requires a checkbox confirmation before overwriting the hash in Supabase

### Edge case: phrase replacement before saving
If the user generates a new phrase but closes the flow without noting it, the old phrase stops working and the new one is lost.

**Mitigation:** A confirmation dialog is shown before entering the claim flow:
> *"This will replace your current recovery phrase. Make sure you're ready to save the new one before continuing."*

The existing checkbox gate in the claim flow protects the second half.

**Important context:** account loss only occurs on a *new device* (or after clearing localStorage). On any previously used device the `userId` persists in `localStorage`, keeping the session active — the user can always return to Settings to generate a new phrase.

## What's Out of Scope

- Displaying or masking any stored phrase (none exists to show)
- Any changes to the claim or recovery views themselves
- Unrelated settings (units, etc.) — placeholders only, not implemented in this iteration
