# User Experience

Owner: R4. Source of truth for behavior: the code in `app/`. Design references: `architecture.md` §15, PRD §18. Screenshots: `screenshots/` (index in `screenshots/README.md`).

## 1. One idea on every screen

Reins lets an AI move money, so the UX has one job: make it obvious that **the agent only proposes and your mandate decides**. Each screen answers one of three questions:

| Question | Screens |
|---|---|
| What is happening with my money? | Home, Subscriptions, Prepaid |
| What did Reins do, and why? | Activity (with "Why?"), Evidence |
| What is Reins allowed to do? | Mandate, Approvals, kill switch |

## 2. Screens (R0)

| Screen | Route | What the user sees | PRD §18.1 |
|---|---|---|---|
| Home | `/` | Balance, balance after obligations, next 14 days, waiting approvals, insights, spending by category | #1, #9 |
| Approvals | `/approvals` | One card per waiting action: amount, registered payee, subject, rule, data origin, expiry; approve or reject | #3 |
| Chat | `/chat` | Streaming chat with bill upload and inline approval cards | #5 |
| Subscriptions | `/subscriptions` | Status, price changes, renewals, trials with auto-cancel and "Keep it", ranked recommendations with cited signals, foreign amounts with base-currency equivalent | #6 |
| Prepaid | `/prepaid` | Packages with sessions left and balance in escrow, merchant signals with sources, offers with the advisor card | #10 |
| Activity | `/activity` | Every action with a tier badge, the deciding rule in plain words, what would make a denial allowed, and "Why?" | #2 |
| Mandate | `/mandate` | Mandate card (read-back), editor, read-back before signing, diff with narrowing/widening, version history | #4 |
| Evidence | `/evidence` | Audit-chain check, JSONL/CSV export, every transaction hash with its explorer link, kill switch | #8 |

Navigation: a sidebar on desktop; on mobile a six-tab bottom bar (Home, Approvals, Chat, Subscriptions, Prepaid, Activity), with Mandate and Evidence reached from Home.

## 3. Trust patterns

These are the rules the UI follows so that what the user sees matches what the system enforces.

1. **Structured fields, not model text.** Approval cards, feed items and the "Why?" trace render from action arguments, registry names and rule IDs through templates. Model text appears only as a labelled, visually secondary "Agent note" (architecture §15.3).
2. **You sign exactly what you read.** The mandate editor sends a structured draft; the server returns the complete policy, the read-back sentences (templates, no model) and its hash. Any edit clears the read-back, so the user cannot sign something they have not reviewed. Activation is refused if the hash or the base version changed.
3. **Widening looks different.** Changes are classed narrowing (Reins gets less room) or widening (more room). Narrowing signs directly. Widening shows an amber notice and stays disabled until the user ticks "I understand this gives Reins more room". The passkey that replaces the tick comes in R1.
4. **Every denial says how to fix it.** A blocked item shows the rule in plain words and, where one exists, what change would allow it.
5. **Provenance is visible.** Values read from a document or the web carry an origin tag; simulated data always says "simulated"; on-chain items show the hash, a Basescan link, and "test token, no value".
6. **Irreversible actions stand out.** Cancellations and prepaid exits get a red outline and a "Cannot be undone" badge on their approval card.
7. **Fail safe, and say so.** Every error state ends with "No money was moved."

## 4. Visual system

- Colors: lime (action, active state), ink (text, primary buttons), grey (structure), lavender (links, data origin). Status colors for ok, warn and danger, each with a soft background (`app/globals.css`).
- Type: Plus Jakarta Sans for UI, Geist Mono for hashes, rule IDs and amounts in traces.
- Tier badges pair an icon with a short label ("Done automatically", "Waiting for you", "Blocked"), so color is never the only signal.

## 5. Mobile and accessibility

- Mobile-first layouts; desktop uses two panes where it helps (Activity list + "Why?" panel).
- Touch targets are at least 44 px (`min-h-11` on buttons and nav items).
- No horizontal scroll at 360 px (checked on Home, Mandate and Evidence).
- PWA manifest and icon for install to the home screen.

## 6. Demo mode

`REINS_FIXTURES=1` serves synthetic data for Lin with no database, so every screen can be shown offline. In this mode the mandate editor, kill switch and export run against process-local state that resets on restart; the real routes are unchanged.

## 7. Not built in R0

| Item | Status |
|---|---|
| Passkey signing for approvals and widening mandate changes | R1; R0 uses session approval and an explicit confirmation tick |
| Prepaid buy sheet with browser signing and key backup (R4-07) | Not built |
| Check-in flow and exit cards (R4-09) | Not built |
| Evidence screen: run-now job buttons and eval report | Not built |
| "Every number has a source tooltip" (PRD §18.2) | Partial: insights and categories show their record counts |
| Data sources screen (PRD §18.1 #7) | Not built |
| Indonesian UI | English only in R0 |
