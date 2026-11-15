[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mansyur0523/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mansyur0523/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar — make.fun bounty `token-radar-01`

A radar for protocols without a token, ranked by what their launch would be worth.
Built for the make.fun bounty "Build the best token launch radar" ($1,325, ends
Mon 14 Dec 2026 17:00 WIB). The entry is the GitHub repository this file lives in;
`main.ts` at the root is the entrypoint.

## What it does

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot at
`../token-radar-01-kit/input/snapshot.json` (758 protocols, floor $50,000,000) and
writes an output directory:

- `board.json` — 178 ranked rows: slug, name, rank, `implied_value_usd`, and a
  7-step farm plan per row. Ranks 1..178, implied values strictly non-increasing
  and all distinct. All 40 watchlist protocols are covered; 138 more pre-token
  protocols below the floor are included; 24 protocols that already trade are
  set aside on the live-token tab, never on the board.
- `data.js` — the dashboard's whole dataset as one script (`window.RADAR`), no
  fetch, no network.
- `dashboard/` — a static, offline page (index.html + app.css + app.js, 3 files,
  ~28 KB): sortable/filterable board, search, category + chain filters, a
  watchlist-only toggle, a live-token tab, a model tab, and a hash-routed detail
  view (`#/p/<slug>`) with the full value breakdown and the farm plan.
- `screenshots/` — three real screenshots of the dashboard (board, detail of the
  rank-1 protocol, board filtered to Risk Curators), 1440×900 JPEG, each under
  512 KiB.
- `dossier.json` — built by the kit's `vendor/makefun-board.ts` `buildDossier`,
  byte-identical to a fresh rebuild from the same output directory.

`vendor/makefun-board.ts` is copied verbatim from the starter kit and is never
modified. `LICENSE` is the MIT license from the starter.

## The model — radar-2

```
implied = TVL × category multiple × growth × maturity × chains
```

- **Category multiple** (0.15–0.50, from the snapshot's own figures, never from a
  hardcoded name): Perpetuals/Derivatives 0.50, DEXs 0.38, RWA 0.35, Lending /
  CDP / Collateral 0.32, Yield / Leveraged Farming 0.30, Risk Curators /
  Allocators 0.30, Basis Trading 0.30, Restaking 0.28, Insurance 0.28, default
  0.25, stablecoin wrappers 0.22, Bridges 0.15.
- **Growth**: the 7-day TVL change, clamped to −80%…+200%; gains count at 0.6,
  losses in full — a shrinking protocol is marked down harder than a growing
  one is marked up.
- **Maturity**: 0.70 at listing, rising to 1.00 at 3 years, easing to 0.90 past
  6 years; an unknown listing date counts as 365 days.
- **Chains**: 1 + 0.02 per extra chain, capped at 5 extra chains.

Top of the board: Steakhouse Financial $791,235,032; Gauntlet $479,140,773;
Veda $429,561,355; USDD $308,614,511; Upshift $159,663,218. Total implied value
across the board: $4,282,050,228. Bottom: Monarq $971,526.

## Farm plans

Seven steps per protocol, built from the protocol's own category and chains
(18 action families, plus a weekly habit and a watch item). Every step carries
its cost and its time — e.g. a Risk Curator plan starts with a fresh wallet,
deposits into a vault on the protocol's largest chain, checks the allocation
weekly, and holds at least 30 days. The detail view states plainly that a
protocol recording no token in the snapshot is not proof it has none, and not
a promise it will ever issue one.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
node verify.mjs out          # all seven gates: board, board_live, board_coverage,
                             # dossier, dossier_matches, dashboard, screenshots
```

Deterministic: two runs write byte-identical output (`diff -r out out2` clean).

Screenshots are taken with `shoot.py`, which drives the dashboard through the
CloakBrowser binary (`launch_persistent_context` with a fresh temporary profile
and the logproxy at 127.0.0.1:18080 — plain Playwright launches of that binary
exit 78 on the license check, and the logproxy dies on VM restarts, so restart
it first if a launch fails). The script re-takes all three shots, then re-run
`main.ts` so the dossier embeds the new images.

## Submission notes (for the person submitting, not the build)

- Do **not** push or submit from this working copy; the submitter handles the
  GitHub push and the make.fun submission.
- The build transcripts are the Muse session file
  `~/agents/agent-d4485516-319d-4933-aa11-89a07ebd3470/sessions/d4485516-319d-4933-aa11-89a07ebd3470.jsonl`
  — bundle it with `--muse-usage` (Muse app sessions carry no token usage on
  their own). Do **not** substitute a handed-over session: under this
  competition's `handed_over_places none`, a handed-over entry is ranked but
  takes no paid place.
- The Solana wallet for the payout is linked to the make.fun account at
  submission time; the entry itself needs no wallet.
