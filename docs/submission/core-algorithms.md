# Core Algorithms

Owner: R1. All algorithms are pure TypeScript in `src/core/detectors` and `src/core/algorithms` (no I/O, clock injected), unit- and property-tested. References: PRD §15.

## 1. Recurring-charge detection (PRD §15.1)

Group transactions by normalized merchant. A series is recurring if it has at least 3 charges with gaps near 7, 30 or 365 days (±3 days) and an amount spread within 10% of the median.

Extensions: one missed cycle is tolerated; a price change with a stable cadence starts a new amount regime instead of breaking the series.

**FX normalization.** If the original currency is known, stability is tested on the original amount. Otherwise each base-currency amount is converted back to the suspected billing currency at its posting-date rate. A USD subscription billed in CNY with ±5% monthly variation is still detected and not flagged as anomalous because of the exchange rate (tested).

## 2. Bill anomaly detection (PRD §15.2)

Robust z-score: `z = |x − median(H)| / (1.4826 · MAD(H))`. Confirm if `z > k` or the history is shorter than `min_history`. Defaults from the mandate: `k = 3`, `min_history = 3`. A conformal option (`q` = the ⌈(n+1)(1−α)⌉-th smallest residual) bounds the chance that a normal bill asks for confirmation by α.

Example: Lin's electricity history of ¥180–260 makes a ¥612 bill anomalous, so it goes to an approval card even though it is under no hard cap.

## 3. Cancel-recommendation score (PRD §15.9)

`score = 3·duplicate + 2·price_increase + 2·trial_converted + 3·low_usage + 1·fx_cost_high + 1·high_share`

Each fired signal is shown with its source. `low_usage` fires only when usage data exists; otherwise the item says "no usage data". The LLM may phrase the explanation but never sets the score.

## 4. FX cost estimate (PRD §15.10)

`annual_fx_cost = original_amount × cycles_per_year × rate × markup_pct`, shown with the rate date and the markup assumption (default 1.5%, configurable).

## 5. Financial summary (PRD FR12a.1)

Income, spending by category, recurring obligations (bills plus subscriptions), the next 14 days, and balance after obligations. Every figure links to its transactions. The same builders serve the agent's `get_financial_summary` tool and the Summary screen.

## 6. Prepaid purchase advisor (PRD §15.11)

Inputs: package price `P` for `N` sessions, pay-per-visit price `q`, expected sessions `n_e` (default `N`), period `t` months (default 12), annual closure rate `λ` (default 10%), unused fraction at closure `u` (default 0.5), escrow available or not.

| Quantity | Formula |
|---|---|
| Savings if fully used | `S = N·q − P` |
| Break-even sessions | `k* = ⌈P / q⌉` |
| Closure probability over the period | `λ_t = 1 − (1 − λ)^(t/12)` |
| Expected loss without escrow | `L = λ_t · u · P` |
| Expected loss with escrow | ≈ 0 (attested exit returns the unused balance) |

Recommendation: `n_e < k*` → pay per visit; escrow available and `S > 0` → prepay through escrow; no escrow and `S − L > 0` → prepay with the risk shown; otherwise pay per visit. An "elevated" soft signal triples `λ` for new purchases and says so.

**Lin's example:** `P = 6,000`, `N = 60`, `q = 125` → `S = 1,500`, `k* = 48`, `L = 300`. "Prepay through escrow if you expect at least 48 visits. Without escrow, the expected loss from a closure is about ¥300." (unit-tested)

## 7. Hard and soft signals (PRD §15.12)

An attestation is valid for an automatic exit only if its signer recovers to the registered oracle address, it names the plan's merchant, it is unexpired and no older than `attestation_max_age_days`, its kind is listed in the mandate's `auto_exit_on`, and the plan is active and owned by the user's wallet. The Gate checks this before Reins submits; the escrow contract checks it again. Complaint and news signals only produce a warning.

## 8. Audit hash chain (PRD §15.8)

`hash_n = SHA-256(hash_{n−1} || canonical(event_n))`, per user. Verification walks the chain and reports the first broken link.
