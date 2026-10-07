# Changes on branch `improvements`

Small fixes for the real use case: two phones sharing lists on the home LAN,
reached from outside over Tailscale/WireGuard. No new dependencies, no schema
changes, no rewrites. The only new CSS is the Undo bar. Each change is its own
commit, so any of them can be reverted or skipped on its own.

**9 code files, +195 / −77 lines** (not counting this file). The database is
untouched; existing data works as is.

| # | Commit | Files | What you'd notice |
|---|--------|-------|-------------------|
| 1 | Remove CORS | server.js, package.json, lock | Nothing (closes a hole) |
| 2 | Docker: reproducible install, fast stop | Dockerfile, compose, README | Redeploys stop in <1s instead of 10s |
| 3 | Sync fixes | server.js, app.js | Phones stop showing different lists |
| 4 | Settings modal works | app.js | ⚙ can rename/delete lists |
| 5 | Confirm "Clear Done" | app.js | No accidental wipe in the store |
| 6 | Search on the device | app.js, index.html | Instant search; export/progress no longer affected by search |
| 7 | Export fixes | server.js | Restoring a backup no longer revives deleted lists |
| 8 | US unit dropdown, decimal qty | index.html, app.js | Pick lb / gal / dozen…; 1.5 lb works |
| 9 | Undo for Clear Done | index.html, app.js, styles.css | 6-second Undo bar instead of a confirm box |
| 10 | Create List "Cancel" button | app.js | Cancel closes the dialog (it did nothing) |
| 11 | Share-friendly export text | index.html, app.js | To buy / Done / All, qty, prices; Copy works on phones |
| 12 | Share icons, remembered options | index.html, app.js, styles.css | One tap to WhatsApp / Messages / Email; options stick per phone |

---

## 1. Remove CORS (`0ae7fbc`)

**Why:** The page and the API come from the same server, so cross-origin access
was never needed. `app.use(cors())` meant any website open in a browser on the
home network could call `http://<server-ip>:7821/api/...` in the background and
read or delete the lists. No login is needed for a home LAN app, but there was
also no reason to leave this open.

**What:** Removed `cors` (require, middleware, dependency) and the
`Access-Control-Allow-Origin: *` header on `/api/events`.

## 2. Docker (`4262a00`)

**Why:**
- `npm install` without the lock file can pull different versions on each build.
- Node running as PID 1 ignores SIGTERM, so every `docker stop` or Portainer
  redeploy waited the full 10s timeout and was then force-killed.

**What:**
- Dockerfile build stage copies `package-lock.json` and runs `npm ci --omit=dev`.
- `init: true` added to `docker-compose.yml` and to the README's Portainer
  snippet. Docker then runs a tiny init process that forwards the stop signal.
  Measured: `docker stop` went from ~10s to 0.56s.

## 3. Sync (`1ac6e91`)

**Why:** This is the main user-facing one. Live updates use Server-Sent Events.
When a phone locks, or the VPN tunnel drops, the browser reconnects
automatically, but any events sent in the meantime are gone. Result: she adds
milk, his phone (which was asleep) never shows it until he pulls to refresh.

**What:**
- `public/app.js`: re-fetch the list when the event stream (re)connects and when
  the tab becomes visible again (`visibilitychange`).
- `server.js`: reordering now broadcasts `ITEMS_REORDERED`. The client also now
  listens for `LIST_UPDATED` / `LIST_DELETED`, which the server already sent but
  nobody handled.
- `server.js`: SSE client ids were `Date.now()`. Two phones connecting in the
  same millisecond got the same id, and when one disconnected both were dropped.
  Now a simple counter.
- `public/app.js`: new `refresh()` replaces the repeated
  `loadItems(...); loadLists(false);` pairs. Every action used to reload twice
  (once after the request, once from its own SSE echo). `refresh()` waits 150ms
  and collapses those into one reload.

## 4. Settings modal (`79a1190`)

**Why:** ⚙ opened an empty modal; `listManagerContainer` and the "+ New List"
button in it were never wired up. There was no way to rename or delete a list
from the UI, although the API (`PUT`/`DELETE /api/lists/:id`) already existed.

**What:** One row per list with ✎ (rename, via `prompt()`) and ✕ (delete, via
`confirm()`). Reuses the existing item-row styles. Refuses to delete the last
list. Delete still **archives** (`is_archived = 1`) as the server already did,
so the data stays in the DB. "+ New List" opens the existing Create List dialog.

## 5. Confirm "Clear Done" (`b50dfb9`)

**Why:** It permanently deletes all checked items and sits right next to
"Reset". One mis-tap in the store and the list is gone.

**What:** `confirm("Remove N checked item(s)?")`; does nothing if none are checked.
*(Superseded by #9: the confirm box was replaced with an Undo bar.)*

## 6. Search on the device (`45f958f`)

**Why:** Every keystroke sent a request to the server; responses could arrive
out of order and show results for an older query. Also, because the search
results *replaced* the item list in memory, three things quietly used only the
matching items: the progress bar, "Export → Current List", and "Download JSON".

**What:**
- `renderItems()` filters the already-loaded list; the server is no longer asked.
  (The server's `?search=` parameter is unchanged, just unused by the UI.)
- Progress, export and download now always cover the whole list.
- Drag handles are hidden while a search is active, since reordering a filtered
  view would only save positions for the visible items.
- Bug found on the way: "List is empty" never showed again after the list once
  had items. `renderItems()` overwrote the container's HTML, which destroyed the
  `#emptyState` element. The message is now rendered inline ("No matches" when
  searching) and the dead element is removed from `index.html`.

## 7. Export (`8d058c0`)

**Why:**
- The full backup included archived (deleted) lists, so restoring brought every
  deleted list back.
- Each item exported `category: i.category`, but the column is `category_id`, so
  this was always empty, and import never read it anyway.

**What:** Export only `is_archived = 0` lists; dropped the always-empty
`category` field. Categories aren't used anywhere in the UI, so nothing is lost.

## 8. US unit dropdown, decimal quantities (`492b51d`)

**Why:** Unit was a free-text box with a "pcs, kg" placeholder. A US household
wants lb, oz, gal, qt etc. one tap away, and quantity only accepted whole
numbers, so 1.5 lb or 0.5 gal couldn't be entered.

**What:**
- Unit is now a `<select>` in both the add form and the edit dialog:
  - **—** (no unit, the default)
  - **Count:** pcs, pack, box, bag, bottle, can, jar, carton, dozen, bunch, loaf
  - **Weight:** oz, lb
  - **Liquid:** fl oz, cup, pt, qt, gal
- The choices live in one `UNITS` constant at the top of `app.js`; edit that to
  add or remove units.
- Older items whose unit isn't in the list (e.g. the sample "tubs") still show
  and save correctly: the edit dialog adds that unit as an extra option instead
  of blanking it.
- Quantity inputs take decimals (`step="any"`, `parseFloat`). The DB column was
  already `REAL`.

## 9. Undo for "Clear Done" (`fed3a09`)

**Why:** A confirm box on every clear is friction; an undo is the usual pattern
and also covers "I tapped OK too fast".

**What:**
- After Clear Done, a bar at the bottom shows "Cleared N item(s) **Undo**" for
  6 seconds.
- **No server change.** Clear Done still deletes the rows. Before that, the app
  keeps a copy of the checked items, and Undo sends it to the existing
  `POST /api/lists/:id/import` endpoint. Name, quantity, unit, price, notes,
  priority and checked state come back; the rows get new ids. The other phone
  sees the removal and then the re-add through the normal live updates.
- Undo lives in memory on the phone that cleared. Reloading the page, or
  clearing again within 6 seconds, drops the earlier undo.
- New: `#undoToast` in `index.html`, `.undo-toast` in `styles.css` (uses the
  existing colour variables, so it follows dark/light mode).

## 10. Create List "Cancel" button

**Why:** In the Create List dialog, **Cancel** had no click handler, so it did
nothing; only ✕ or tapping outside closed it. (The ✕ buttons work through the
shared `.modal-close` handler; Cancel uses `btn-outline` instead, so it was
missed.) Already present before this branch.

**What:** One listener in `initEventListeners()`:
`btnCancelListModal` → `closeModal('listModal')`, matching how the Edit dialog's
Cancel is wired. Checked every `btn*` id in `index.html`: this was the only
button with no handler.

## 11. Share-friendly export text (`43bf8b9`)

**Why:** The usual reason to export the current list is to paste it into
WhatsApp or Discord ("can you pick these up?"). The old text was a fixed
`SHOPLIST / ------` block of every item, checked or not. Also, **Copy Text did
not work on the phones at all**: `navigator.clipboard` only exists on HTTPS or
localhost, so on `http://<LAN-IP>` or a Tailscale IP the button threw an error
and copied nothing.

**What:** Export → Current List now has options:
- **Show:** To buy (default) / Done / All.
- **Qty** (on): `- Milk - 0.5 gal`, or `x3` when an item has no unit.
- **Prices** (off): cost per line plus a `Total:` line.

Example ("To buy", Qty on):
```
Weekly Groceries (to buy)

- Whole Milk (1 Gallon) - 0.5 gal
- Sourdough Bread - 1 loaf
```
"All" keeps `[ ]` / `[x]` so you can tell what's done. The options row hides
when "All Lists (Full Backup)" is selected.

- **Copy Text** falls back to selecting the text box and `execCommand('copy')`
  when the clipboard API is missing (it briefly turns off `readonly`, because
  iOS won't select inside a read-only box). The button shows "Copied ✓"
  instead of an `alert()`.
- **Share** button opens the phone's share sheet (straight to WhatsApp etc.)
  via `navigator.share`. Browsers only allow this on HTTPS, so on plain http it
  stays hidden. If you ever put it behind `tailscale serve` (HTTPS), it shows up
  on its own.

All the logic is in `formatListText()` and `copyText()` in `app.js`.

## 12. Share icons and remembered options (`86bee94`)

**Why:** Copy → switch app → paste is three steps. The system Share button
from #11 only appears on HTTPS, so on the home http setup there was no
one-tap way to send the list.

**What:**
- A row of icons under the preview:
  - **WhatsApp** opens `https://wa.me/?text=…` (the WhatsApp app on a phone,
    WhatsApp Web on a computer) with the text filled in; you pick the chat.
  - **Messages** opens `sms:?&body=…` (iMessage/SMS; the `?&` form works on both
    iPhone and Android).
  - **Email** opens `mailto:?subject=<list title>&body=…`.
  - **Share** (system share sheet, from #11) moved into this row as an icon.
    Still HTTPS-only.

  These are ordinary links, so they work over plain http. Their addresses are
  rebuilt whenever the text changes. **Discord has no share link**, so for
  Discord it's still Copy Text + paste.
- Icons are inline SVG (WhatsApp glyph from Simple Icons, CC0; the others
  Feather-style, MIT): no extra files or requests. They reuse `.btn-icon`; one
  new CSS rule, `.btn-icon[hidden] { display: none }`, because `.btn-icon`'s
  `display: flex` would otherwise override `hidden`.
- **Options are remembered on each phone** (To buy/Done/All, Qty, Prices), in
  `localStorage` under `shoplist_export_options`. First-time default is
  **To buy + Qty**. If storage is unavailable (private browsing) it simply uses
  that default.

---

## Deliberately not changed

- **Login/HTTPS:** not needed. Access is the LAN plus Tailscale, which already
  authenticates and encrypts.
- **Unused features in the schema** (categories, frequent items, priority,
  notes, actual price): left in place. Removing columns would need a migration.
- **Offline mode** (service worker to show the list when the store has no
  signal): about 30 more lines. Worth adding only if signal in the store is a
  real problem.
- **Input validation:** the API accepts anything (e.g. `quantity: "abc"`). The
  only client is the app's own form, which sends sane values.

## How this was tested

Built the Docker image from this branch and ran it on a fresh volume:

- No `Access-Control-*` headers on API responses.
- SSE stream received `ITEMS_REORDERED`, `LIST_CREATED`, `LIST_DELETED`.
- Export contained no archived list and no `category` field.
- `docker stop` with init: 0.56s.
- In a browser:
  - Search "ban" shows 1 item, with no drag handles; "zzz" shows "No matches";
    clearing the search brings the handles back.
  - ⚙ lists the lists; renaming updates both the modal and the dropdown;
    deleting the last list is refused.
  - "Clear Done": Cancel keeps the items, OK removes them.
  - An item added by "another device" (a direct API call) appears within 0.6s,
    with exactly one reload; the app's own add also triggers exactly one reload.
  - `visibilitychange` triggers a refresh.
  - Unit dropdown shows the three groups and defaults to "—". Adding "Chicken"
    at 1.5 lb saves and displays as "Qty: 1.5 lb". Editing the sample "tubs"
    item keeps "tubs". Changing milk to 0.5 gal saves.
  - Clear Done on 2 checked items shows "Cleared 2 item(s)" and removes them.
    Undo restores both with the same qty, unit and price. Without Undo, the bar
    hides after 6s and the items stay cleared. With nothing checked, no bar.
    Checked at 390px phone width: the bar sits on one line at the bottom.
