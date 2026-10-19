# Reins: UI Direction

How the app looks, talks and lays out on phone and desktop. Read this before building a screen.

Sources: PRD §18 (UX), FR14.1 (mobile-first, desktop two panes), `architecture.md` §0.5 and §15, the logo kit in `docs/brand/` (branch `feat/brand-logo` until merged), and the reference images in `references/`. Owner: R4.

---

## 1. The feel in one line

**A calm money ledger you can stop at any time. Not a chatbot.**

Reins moves money for people. The screen should look like a clear statement from a careful bank, with the user's rules always in sight. Nothing flashy, nothing that looks like it is guessing.

## 2. Who looks at it

| Who | Where | What they need |
|---|---|---|
| Lin (demo user) | Phone, one hand, in a hurry | What is due, what needs her OK, a way to stop everything |
| Judges | Laptop or projector, 3 to 10 minutes | Understand what happened and why, without us explaining |

Both layouts matter. Build every screen mobile-first, then give it a proper desktop layout. Desktop is not a stretched phone.

## 3. What we took from the references

| Reference | We take | We leave out |
|---|---|---|
| `dashboard-1.png` (orange dashboard) | Big amounts with the decimals in a lighter colour (**¥1,842**.56). A clear list of recent items. | Full gradient cards. A `+2.46%` chip on every number. A giant "Welcome Back!" heading. |
| `dashboard-2.1.png` (velmo overview) | Left sidebar with grouped navigation. A calm grid with plenty of space. | Purple gradient hero card. Half-circle gauge chart. Striped goal bars. Upgrade advert in the sidebar. |
| `dashboard-2.2.png` (velmo send money) | The **Summary panel** on the right: a short list of label and value rows, a total, one button. The "banks charge ¥25, you keep ¥24.66" comparison line. This becomes our approval detail and prepaid buy sheet on desktop. | A four-step progress bar for a one-tap action. |
| `mobile-1.png` (dark banking app) | Dark header with one key number. A light sheet pulled up over it holding the list. List grouped by day. Detail sheet made of label and value rows. Floating pill tab bar. | "Revolutionize your banking" hero copy. The decorative map. |
| `mobile-random-screen-include-mascot.png` | Only the idea of a clear success moment: big amount, one sentence, a few facts. | The mascot and the confetti. **Decided: no mascot anywhere.** |

## 4. Six rules for every screen

1. **Show what will happen before it happens.** Amount, who gets paid, and when, on screen before any button.
2. **Every number says where it came from.** Tap it (hover on desktop) to see the source: bank, bill, your rules, exchange rate and its date.
3. **One main button per screen.** Everything else is a quiet text button.
4. **"Pause everything" is always one tap away.** Top of Home on mobile, bottom of the sidebar on desktop.
5. **Say "we think" when we are not sure.** "We think this is a subscription" until the user confirms.
6. **The agent's words are never the main content.** Cards are built from real data. Text written by the AI appears only as a small line labelled "Agent's note".

## 5. Words

Use plain words. The user should never need to know how the system works inside.

| In the code and docs | On screen |
|---|---|
| Mandate | **Your rules** |
| Policy Gate | **Rule check** |
| T3 (allowed, autonomous) | **Done for you** |
| T2 (require confirm) | **Needs your OK** |
| T1 (proposal) | **Suggestion** |
| Denied | **Blocked** |
| Escrow | **Held safely until you use it** |
| Attestation | **Official notice** |
| Kill switch | **Pause everything** |
| Audit log | **Record** |
| Hash chain verified | **Tamper check: passed** |
| Payee registry | **Saved payees** |
| Widening a mandate | **Giving Reins more permission** |
| Narrowing a mandate | **Giving Reins less permission** |

**Copy rules**

- Short sentences. Say what happened, then what to do. "Electricity bill paid. ¥312.40 to Shenzhen Power."
- Name the rule that decided: "Paid because of your rule: bills under ¥500 pay automatically."
- When something is blocked, say what would allow it: "Blocked: this payee is not in your saved payees. Add it in Saved payees to allow it."
- No exclamation marks on money screens. No emoji. No em dashes.
- Never use: seamless, effortless, smart, AI-powered, magic, unleash, revolutionize, next-gen, empower, elevate.
- Never say "AI" in the UI. Call it "Reins" or "the agent".

## 6. Look

### Colour

Light mode is the default. Dark mode follows the system setting. Never pure black or pure white.

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#16161B` | `#F5F5F2` | Main text, logo, primary button fill |
| `page` | `#F5F5F2` | `#16161B` | Page background |
| `surface` | `#FDFDFB` | `#1F1F25` | Cards, sheets, panes |
| `muted` | `#6B6B73` | `#A1A1AA` | Secondary text, labels |
| `line` | `#D1D5DB` | `#2C2C33` | Borders, dividers |
| `lime` | `#EBFE06` | `#EBFE06` | Brand accent (see rule below) |

**Lime rule.** Lime goes only on ink (logo, active tab, the dark header) or as a button fill with ink text (16:1). Lime text on a light background is banned: 1.1:1, unreadable.

**Status colours.** Each status always has an icon and a label too, never colour alone.

| Status | Text (light) | Background (light) | Text (dark) | Icon (Phosphor) |
|---|---|---|---|---|
| Done for you | `#17703D` | `#E6F4EC` | `#4ADE80` | `CheckCircle` |
| Needs your OK | `#8A5A00` | `#FFF1D6` | `#FBBF24` | `HandPalm` |
| Suggestion | `#2457C5` | `#E8EEFB` | `#8AB4F8` | `Lightbulb` |
| Blocked | `#B42318` | `#FDECEA` | `#F87171` | `Prohibit` |

All text and background pairs above pass WCAG AA (4.5:1 or better).

### Type

- **Plus Jakarta Sans** for all UI text.
- **Amounts** use Plus Jakarta Sans with tabular figures, so columns line up without looking like a terminal.
- **Geist Mono** only for rule IDs, hashes and codes.
- Amounts: whole part in `ink`, decimals in `muted`. Currency symbol before the number: `¥4,800.00`.
- Sizes: page title 24/28 (mobile/desktop), key number 40/48, body 15/16, labels 13.
- `app/layout.tsx` still loads Geist Sans from the starter. Switch it to Plus Jakarta Sans.

### Shape and depth

- Corners: cards and sheets **16 px**, inputs **12 px**, buttons, tabs and badges **fully round**. Nothing else.
- Flat. Group with space and thin `line` dividers, not boxes inside boxes.
- One shadow only, for sheets and modals, tinted with ink at low opacity.

### Icons

**Phosphor** (`@phosphor-icons/react`), regular weight, one size per context (20 px in lists, 24 px in the tab bar). This replaces "lucide-react [decide Day 1]" in `architecture.md` §0.5. No other icon set, no hand-drawn icons.

### Density

Calm and predictable. Same layout in the same place on every screen. Phones get more space; desktop shows more at once; the Evidence screen is the densest.

## 7. Two layouts

One codebase, one set of pages. The break is at **1024 px** (Tailwind `lg:`).

### Mobile (under 1024 px)

```
┌──────────────────────────────┐
│ ▣ reins          [Pause ⏸]  │  ink header, lime logo
│                              │
│ Due in the next 14 days      │
│ ¥2,184.40                    │  key number, decimals muted
│ 2 need your OK               │
├──────────────────────────────┤
│ ╭──────────────────────────╮ │  light sheet over the header
│ │ Needs your OK            │ │
│ │  Cancel ChatGPT Plus   › │ │
│ │  Water bill    ¥89.00  › │ │
│ │ Today                    │ │
│ │  Shenzhen Power ¥312.40 ✓│ │
│ │ Tomorrow                 │ │
│ │  Rent        ¥3,800.00   │ │
│ │                          │ │
│ │ [ Ask about your money ] │ │  opens full-screen chat
│ ╰──────────────────────────╯ │
│  ( Home  Activity  Subs  Prepaid  Rules )  floating pill tab bar
└──────────────────────────────┘
```

- **Tab bar:** Home, Activity, Subscriptions, Prepaid, Rules. Badge on Home when something needs an OK.
- **Details and approvals** open as a **bottom sheet** (drag handle, close button, one main button at the bottom).
- **Chat** is a bar on Home, not a tab. It opens full screen.
- **Evidence** is reached from Activity ("See full record").

### Desktop (1024 px and up)

```
┌────────────┬──────────────────────────────┬─────────────────────┐
│ ▣ reins    │ Home                         │ Cancel ChatGPT Plus │
│            │ Due in the next 14 days      │ Needs your OK       │
│ Home     • │ ¥2,184.40                    │                     │
│ Activity   │                              │ Saves    $20.00/mo  │
│ Subs       │ Needs your OK                │          ¥146.20/mo │
│ Prepaid    │ ▸ Cancel ChatGPT Plus        │ Last use 47 days ago│
│ Rules      │   Water bill         ¥89.00  │ Why ask  Cancelling │
│ ────────── │ Today                        │          needs OK   │
│ Evidence   │   Shenzhen Power    ¥312.40  │ Rule     §subs v7   │
│            │ Tomorrow                     │ Source   Bank, 18 Oct│
│            │   Rent            ¥3,800.00  │ Expires  in 23 h    │
│            │                              │                     │
│ [Pause ⏸] │ [ Ask about your money ]     │ [Approve] Decline   │
└────────────┴──────────────────────────────┴─────────────────────┘
   240 px              flexible list               ~400 px detail
```

- **Left sidebar (240 px):** logo, the same five sections plus Evidence, "Pause everything" pinned at the bottom.
- **Middle:** the list for the current section.
- **Right pane (~400 px):** the detail of the selected row, built like the velmo Summary panel: label and value rows, a total, one main button.
- Approvals open in the right pane. When triggered from outside a list (for example from chat), they open as a centred modal (PRD §18.1).
- Max width 1440 px, centred. Between 1024 and 1279 px the right pane narrows to 360 px.

## 8. Screen by screen

R0 must-have screens from `roles.md`. Data routes from `architecture.md` §15.2.

| Screen | What it is for | Mobile | Desktop | Data |
|---|---|---|---|---|
| **Home** | What is coming, what needs me, stop button | Ink header with the 14-day total and Pause; sheet with "Needs your OK", then upcoming items by day; Ask bar | List in the middle, selected item on the right; summary numbers above the list | `/api/summary`, `/api/approvals`, `/api/chat` |
| **Approvals** | Say yes or no to one exact action | Bottom sheet, opened from Home or a notification | Right pane, or modal from chat | `/api/approvals` |
| **Activity** | Everything Reins did or tried, and why | List by day with a status badge per row; tap for "Why?" sheet | List in the middle, "Why?" in the right pane | `/api/feed` |
| **Subscriptions** | What I pay every month, what to cancel | Tabs: Active, Trials, Cancelled. Suggestions on top with the reason ("not used for 47 days") | Same list, detail with price history and cancel button on the right | `/api/subscriptions`, `/api/recommendations` |
| **Rules** | Read and change what Reins may do | Rules as plain sentences, version and signed date, "worst case per day: ¥800"; Edit opens the editor | Rules on the left of the main area, change history on the right | `/api/mandates/*` |
| **Prepaid** | My packages and the money still held | One card per package: sessions as small segments (12 of 60 used), "¥4,800 held safely until you use it", gym risk status with sources | Package list in the middle, detail with check-in, exit and transaction links on the right | `/api/prepaid/*` |
| **Evidence** | Prove what happened (mostly for judges) | Simple list, "View on a larger screen for the full table" | Full table: time, action, decision, rule, tamper check, transaction link; Export button | `/api/audit/*` |
| **Gym tablet** | Show the check-in code at the gym (demo only) | n/a | Full-screen QR code, gym name, session number. Nothing else. | `/sim/merchant/checkin/:planId` |

**Rules screen, giving more permission.** Changes that give Reins less permission apply right after signing, in the normal style. Changes that give more permission use the Blocked colour as a warning border, show what gets bigger ("Auto-pay limit ¥500 → ¥1,000"), and keep the Sign button disabled for a 10 second review (PRD FR6.7).

**Prepaid success moment.** After an exit: check icon, the amount large, one sentence, two facts. No mascot, no confetti.

```
  ✓
  ¥4,800.00
  is back in your wallet.
  Reason      Official notice: FitBox is closing
  Sessions    12 of 60 used
  [ Done ]
```

## 9. Key components

**Approval card** (same content in the bottom sheet and the right pane, built from the action's real data, never from AI text)

```
Cancel ChatGPT Plus             Needs your OK
Saves       $20.00 a month  ≈ ¥146.20 (rate 18 Oct)
Renews      21 Oct
Last used   47 days ago (simulated)
Why we ask  Your rules say cancelling needs your OK
Rule        §subscriptions.cancel_needs_confirm  v7
Data from   Bank statement, 18 Oct
Expires     in 23 h
Agent's note  You also pay for Claude Pro, which you use daily.
[ Approve ]            Decline
```

| Component | Rules |
|---|---|
| **Status badge** | Pill, icon + label + status colour. Screen-reader label says the full status. |
| **Money** | Mono, decimals muted. Foreign amounts show the base currency below with the rate date. |
| **Source popover** | Tap on mobile, hover or focus on desktop. Says where the number came from and when. |
| **Simulated tag** | Small grey pill "Simulated" on any simulated data (FR2.8a). |
| **Chain tag** | Short hash, link to Basescan, grey pill "Test token, no value". |
| **Agent's note** | One line, `muted`, smaller, with the label. Never bold, never first. |
| **Pause everything** | Outline button with `Pause` icon. Pressing it asks once ("Pause all payments and cancellations?"), then the header turns to a paused state with a Resume button. |

## 10. States

- **Loading:** grey blocks shaped like the final rows and numbers. No spinners on whole screens.
- **Empty:** say what to do. "No bills yet. Connect your bank or load the demo data."
- **Error:** fail-safe and calm. "The agent is unavailable. No money was moved." Then a Retry button.
- **Expired approval:** "This request expired. Nothing was paid. Ask Reins to check again."

## 11. Motion

Only movement that explains something:

- Bottom sheet slides up; right pane content fades in when the selection changes.
- New items in Activity slide in from the top.
- Buttons press down slightly when tapped.

Nothing loops. Respect `prefers-reduced-motion`: everything becomes instant.

## 12. Do not

- Purple or blue "AI" gradients, glows, neon.
- Sparkle or robot icons for the agent.
- A chat screen as the home page.
- Mascots or confetti, anywhere.
- `+x%` chips with no source.
- Three equal cards in a row.
- Gauge or donut charts for decoration.
- Small uppercase labels above every section.
- Em dashes in any text.
- Fake avatars or "John Doe" names. Demo data uses Lin and real Shenzhen billers.
- Buttons whose label wraps to two lines.
- Lime text on a light background.

## 13. Accessibility

- WCAG 2.1 AA contrast for all text (pairs in section 6 are checked).
- Touch targets at least 44 px.
- Status never shown by colour alone.
- Every icon-only button has a label.
- Full keyboard use on desktop: list rows are focusable, Enter opens the detail, Escape closes sheets and modals.

## 14. Decided and open

**Decided:** no mascot; Phosphor icons; ink and lime with paper; Plus Jakarta Sans and Geist Mono; light by default with dark mode; break at 1024 px.

**Open (R4):** which device runs the live pitch (laptop or a phone mirrored to the projector). That decides which layout gets the final polish in R4-11.
