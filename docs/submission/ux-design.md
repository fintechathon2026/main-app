# UX Design

Owner: R4. Source of truth for the look and wording: `docs/ui-direction.md`. Screens are in `src/ui/screens/`. Screenshots are in `docs/screenshots/`.

## 1. What the app is

Reins is one web app that works on a phone and on a laptop. It is built phone first. At 1024 px and wider it switches to a desktop layout with a sidebar and a detail pane. A native app is planned for a later release.

The look is a calm money ledger, not a chatbot. The user sees what is due, what needs their OK, and a "Pause everything" button that is always one tap away.

## 2. Six rules every screen follows

1. **Show what will happen before it happens.** Amount, who gets paid and when are on screen before any button.
2. **Every number says where it came from.** Tap the small info icon to see the source: bank, bill, the user's rules or the exchange rate and its date.
3. **One main button per screen.** Everything else is a quiet text button.
4. **"Pause everything" is always one tap away.** It sits at the top of Home on a phone and at the bottom of the sidebar on a laptop. The screen only says "paused" after the server confirms.
5. **Say "we think" when the system is not sure.**
6. **The AI's words are never the main content.** Cards are built from real fields. Text written by the AI appears only as a small line labelled "Agent's note".

These rules turn the safety guarantees into what the user sees. An approval card shows the exact action that will run, so the user approves one thing, not a description of it.

## 3. Words

The screen never uses internal terms.

| Inside the system | On screen |
|---|---|
| Mandate | Your rules |
| Policy Gate | Rule check |
| Allowed on its own | Done for you |
| Requires confirmation | Needs your OK |
| Proposal | Suggestion |
| Denied | Blocked |
| Escrow | Held safely until you use it |
| Attestation | Official notice |
| Kill switch | Pause everything |
| Audit log | Record |
| Hash chain verified | Tamper check: passed |

Status is never shown by colour alone. Each status has its own icon and label: Done for you, Needs your OK, Suggestion, Blocked.

## 4. The screens

Each screen has a phone layout and a desktop layout.

| Screen | What it is for |
|---|---|
| Home | What is due in the next 14 days, what needs the user's OK, what comes up next, and a bar to ask Reins a question. Approving happens in a bottom sheet on a phone and in the right pane on a laptop. |
| Activity | Everything Reins did or tried, newest first. Opening an item shows its "Rule check": the steps the rules went through, in order. |
| Subscriptions | Active subscriptions, free trials, and suggestions to cancel with the yearly saving. |
| Prepaid | Packages the user has paid for, sessions used, money held safely, early warning signs about the business, the advice card (break-even and expected loss with and without safe holding), and the exit result. |
| Your rules | The signed rules as plain sentences, each generated from the policy fields, plus version history and a way to ask for a change. |
| Evidence | The full record, the tamper check, and CSV and JSON export. A table on a laptop, a simple list on a phone. |
| Chat | Streaming questions and answers. Anything that needs approval links to its card on Home. |

## 5. Screenshots

All shots are in `docs/screenshots/`, named `<device>-<screen>-<mode>.png`. Devices are `desktop` (1440 x 900) and `mobile` (390 x 844). Modes are `light` and `dark`. Screens are `home`, `activity`, `subscriptions`, `prepaid`, `rules`, `evidence` and `chat`.

They were taken from a production build with `REINS_FIXTURES=1`. Where a route is not built yet, the screen shows labelled sample data (a "Sample data" tag next to the title). Buttons always call the real route.

## 6. Colour and type

- **Ink** `#16161B` for the dark header and the main button. **Lime** `#EBFE06` only on ink, or as a fill with ink text.
- **Paper** `#F5F5F2` for the page, `#FDFDFB` for cards.
- Four status colours, each with a light and a dark version: green (done), amber (needs OK), blue (suggestion), red (blocked).
- Plus Jakarta Sans for text. Amounts use tabular figures, with the decimals in a lighter colour. Geist Mono is used only for rule IDs and hashes.
- Icons are Phosphor. There is no mascot and no confetti.

## 7. Failing safely

- If a request fails, the screen says so and adds "No money was moved".
- Loading screens are shaped like the final layout.
- Empty screens say what to do next.
- An approval that expired or was already used shows a plain message and does nothing.

## 8. Accessibility

- Colours were picked to meet WCAG AA contrast in light and dark.
- Touch targets are at least 44 px.
- Motion is limited to sheets, pane changes and button presses, and it stops when the device asks for reduced motion.
- Status badges have screen reader labels.
- Text inputs are 16 px on a phone so iOS does not zoom in.

## 9. Not built yet

- Browser signing for buying, check-in and leaving early (needs the purchase, check-in and exit routes).
- The gym tablet page.
- Reading a rule change back with a diff and the 10 second review for widening (needs the compile route).
- Sign in screen.
