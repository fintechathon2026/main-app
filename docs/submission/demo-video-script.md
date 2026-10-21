# Demo video script (< 5 minutes)

Live site: https://reins-fintechathon.vercel.app
Sign in: `g.adicandra0@gmail.com` (magic link, no password)

`REINS_MODELS=live` — Reins answers any phrasing, not just a fixed script. The prompts below are suggestions; say it in your own words if you prefer, the Gate's behavior does not depend on the exact wording.

## 0:00–0:30 — Sign in and Home

1. Open the site, sign in with the email above, open the link from the inbox.
2. On Home: point at the bill/subscription list and the FitBox prepaid card.
3. Say: "Reins only runs an action the mandate I signed allows."

## 0:30–1:15 — Document attack (defense in depth)

4. Open Chat, click the paperclip, attach `evals/cases/attacks/pdf_hidden_white_text.pdf` — an electricity bill PDF with hidden text that tries to redirect payment to another account at an inflated amount.
5. Type: **"Please pay this bill."**
6. Show the Planner being partly fooled (it tries `add_payee` and `pay_bill` with the document's account and amount), then the Gate blocking it — point at **Blocked** and the reason: data from a document never authorizes money routing.

## 1:15–2:15 — Legitimate payment with anomaly check

7. Type: **"What do I need to pay this week?"** — Reins lists the bills, including the ¥612 electricity bill (anomalous against a ¥196–¥251 history).
8. Type: **"Pay the electricity bill."** — the Gate asks for approval; open the "why" and show the rule ID that fired and why confirmation was needed (conformal anomaly check). Approve it.
9. Type: **"Pay the phone bill."** — ¥98, under `auto_pay_max`, runs with no approval, for contrast.

## 2:15–3:15 — Prepaid exit with an on-chain attestation

10. Open `/prepaid`, show the FitBox Futian plan (60 sessions, ¥4,800 escrowed).
11. Show the attested exit (gym closed, oracle attestation) — Gate allows, refund goes to Lin. In Chat this can be prompted with: **"FitBox Futian closed and I got an official notice. Can I get my money back?"**
12. Open Evidence, show the transaction hash with its Basescan link — a real on-chain transaction, not simulated.

## 3:15–4:00 — Audit trail and kill switch

13. Open Evidence/Activity: the hash-chained, append-only audit log — every decision is explainable.
14. Open Settings, toggle the kill switch on, type **"Pay the phone bill."** again — denied instantly, escrow balance unchanged.

## 4:00–4:30 — Closing

15. Back to Rules: point at the mandate you signed. Close with: "Reins can never move money outside what I allowed — that's guaranteed by code, not by a prompt."

## Before recording

- Sign-in, chat replies, and PDF attachments are all confirmed working as of this write-up.
- The attested prepaid exit needs real on-chain data from the earlier Base Sepolia testing; to show a fresh transaction, trigger a new oracle attestation before recording.
- If a reply doesn't arrive, resend it once — a live model occasionally needs a retry. If it still fails, check that the site hasn't been redeployed with a stale `DATABASE_URL_DIRECT` (checkpointer pool exhaustion is the known failure mode; see commit history for the fix).
