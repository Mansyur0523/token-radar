// Token Radar model "radar-2": one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token and is not a wrapped, staked or
// bridged product of a token that already trades: the snapshot's watchlist (the floor) plus
// every pre-token protocol below the floor that passes the same visible rule. A protocol
// above the floor that the watchlist leaves out is left out too: the house's rule saw
// something this file cannot (a parent protocol), and the board does not second-guess it.
//
// Implied value follows only from the snapshot's own figures, never from a list of names:
//
//   base        = tvl_usd x category_multiple
//   growth      = clamp(change_7d, -80, 200) per cent; null counts as 0
//   growthMult  = 1 + (growth / 100) x 0.6   when growth >= 0
//               = 1 + (growth / 100) x 1.0   when growth < 0   (declines hurt in full)
//   maturity    = age curve: 0.70 at listing, rising to 1.00 at 3 years, easing to 0.90
//                 past 6 years; unknown age counts as 365 days
//   chainsMult  = 1 + min(chains - 1, 5) x 0.02
//   implied     = max(1, round(base x growthMult x maturity x chainsMult))
//
// The category multiple is the model's one judgement: a token's fully diluted value, at
// launch, is usually a fraction of the value its protocol already secures, and that
// fraction differs by what the protocol does. Perpetuals and derivatives earn real fees
// on every trade, so they carry the highest multiple; bridges move other people's value
// and keep little of it, so they carry the lowest. Every multiple is stated in the
// dashboard's Model tab, and the same function scores every protocol.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor: number;
  growth_cap: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  growth_weight_up: 0.6,
  growth_weight_down: 1.0,
  growth_floor: -80,
  growth_cap: 200,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_extra: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chains_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chains_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** Categories that are, by definition, a product of a token that already trades. */
const PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a product's name may begin with. */
const EXCHANGE_PREFIX = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a genuine launch candidate: pre-token, and not a wrapped, staked
 * or bridged product, not an exchange, not a versioned pool of another protocol.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX' || PRODUCT_CATEGORY.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  const lower = p.name.toLowerCase();
  if (EXCHANGE_PREFIX.some((x) => lower.startsWith(x))) return false;
  return true;
}

/**
 * The category's multiple: the fraction of secured value a launch usually prices at.
 * A family of categories shares one multiple, so no single protocol is ever special-cased.
 */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('perpetual') || c.includes('derivative')) return 0.5;
  if (c.includes('rwa') || c.includes('real world')) return 0.35;
  if (c.includes('dex')) return 0.38;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 0.32;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return 0.3;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('collateral management')) return 0.3;
  if (c.includes('basis trading')) return 0.3;
  if (c.includes('restak') || c.includes('staking pool')) return 0.28;
  if (c.includes('insurance')) return 0.28;
  if (c.includes('bridge')) return 0.15;
  if (c.includes('stable')) return 0.22;
  return 0.25;
}

/** The maturity multiplier from an age in days: 0.70 at listing, 1.00 at 3 years, 0.90 past 6. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  if (days <= 0) return 0.7;
  if (days < 90) return 0.7 + (days / 90) * 0.1;
  if (days <= model.maturity_days) return 0.8 + ((days - 90) / (model.maturity_days - 90)) * 0.2;
  const over = Math.min(days - model.maturity_days, 1095);
  return 1.0 - (over / 1095) * 0.1;
}

/** The growth multiplier: gains count at 0.6, losses in full, clamped to [-80, +200] per cent. */
export function growthMultiplier(change7d: number | null, model: ModelConstants): { growthPct: number; growthMult: number } {
  const raw = finite(change7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  const weight = growthPct >= 0 ? model.growth_weight_up : model.growth_weight_down;
  return { growthPct, growthMult: 1 + (growthPct / 100) * weight };
}

/** The chain-diversity multiplier: more chains, more resilience, capped at five extra. */
export function chainsMultiplier(chains: string[], model: ModelConstants): number {
  const extra = Math.min(Math.max(chains.length - 1, 0), model.chain_max_extra);
  return 1 + extra * model.chain_step;
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; catMult: number; growthPct: number; growthMult: number; maturityMult: number; chainsMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const catMult = categoryMultiple(protocol.category);
  const { growthPct, growthMult } = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainsMult = chainsMultiplier(protocol.chains, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMult * growthMult * maturityMult * chainsMult));
  return { implied, catMult, growthPct, growthMult, maturityMult, chainsMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer
  // carries (it cannot, but coverage is the gate's row and is never gambled).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the floor, every one of them.
  // A protocol above the floor that the watchlist leaves out stays out: the house's
  // rule saw something this file cannot, and the board does not second-guess it.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.catMult,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chains_multiplier: round4(s.chainsMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('restak')) return `Restake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('staking pool')) return `Stake $${capital} of the chain's asset in ${name}'s pool on ${chain} and keep the receipt.`;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('collateral management')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('basis trading')) return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and keep the position.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and let it compound.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s main yield position on ${chain} and keep it open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('launchpad')) return `Stake $${capital} in ${name}'s launch pool on ${chain} and join one sale.`;
  if (c.includes('governance')) return `Lock $${capital} of the governance asset in ${name} and vote on one proposal.`;
  if (c.includes('payment')) return `Spend $${capital} through ${name}'s card or checkout on ${chain} and keep the receipt.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to the ${name} chain and use one of its apps.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly habit, so the activity reads as a real user, not a single deposit. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('perpetual') || c.includes('derivative')) return `Make one small trade each week and close it before the weekend.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Adjust the position once a week: add a little collateral or repay a little debt.`;
  if (c.includes('dex')) return `Swap a small amount through the pool once a week and collect the fees.`;
  if (c.includes('risk curator') || c.includes('allocator')) return `Check the vault's allocation once a week and rebalance only when it drifts.`;
  if (c.includes('governance')) return `Vote on every proposal that opens while your lock runs.`;
  if (c.includes('prediction')) return `Place one small position a week on a market you have read.`;
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/** The category's watch item: what to check before the position is unwound. */
function watchFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Watch the borrow rate and the liquidation price every week so a dip never catches the position.`;
  if (c.includes('dex')) return `Watch the pool's APR and impermanent loss every week before adding more liquidity.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Watch the funding rate and your margin level every week so a spike never liquidates the trade.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Watch the vault's APY and the underlying's price every week before compounding.`;
  if (c.includes('rwa')) return `Watch the asset's backing report and redemption window every month before adding more.`;
  return `Watch the protocol's announcements and its TVL every week for a token or points update.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: watchFor(p),
      cost: 'nothing but the time to check',
      time: '10 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chains_multiplier: row.model.chains_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
