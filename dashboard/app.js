/* Token Radar dashboard: board, detail, live-token and model views. No network. */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !D.rows) { document.getElementById('app').innerHTML = '<p class="loading">No radar data on this page.</p>'; return; }

  var rows = D.rows, live = D.live || [];
  var watch = {};
  (D.watchlist || []).forEach(function (s) { watch[s] = true; });
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { tab: 'board', q: '', cat: '', chain: '', wl: false, sort: 'rank', dir: 1, sel: null };
  var app = document.getElementById('app');

  /* ---------- formatters ---------- */
  function money(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function moneyFull(n) {
    if (n == null) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(v) {
    if (v == null) return '<span class="flat">n/a</span>';
    var c = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return '<span class="' + c + '">' + s + '</span>';
  }
  function ageStr(d) {
    if (d == null) return 'unknown';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.floor(d / 30) + 'mo';
    var y = Math.floor(d / 365), m = Math.floor((d % 365) / 30);
    return y + 'y' + (m ? ' ' + m + 'mo' : '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function chainsHtml(chains) {
    if (!chains || !chains.length) return '<span class="flat">—</span>';
    var show = chains.slice(0, 3).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
    if (chains.length > 3) show += '<span class="chip">+' + (chains.length - 3) + '</span>';
    return show;
  }
  function catMult(c) {
    var x = (c || '').toLowerCase();
    if (x.indexOf('perpetual') >= 0 || x.indexOf('derivative') >= 0) return 0.50;
    if (x.indexOf('dex') >= 0) return 0.38;
    if (x.indexOf('rwa') >= 0 || x.indexOf('real world') >= 0) return 0.35;
    if (x.indexOf('lend') >= 0 || x.indexOf('cdp') >= 0 || x.indexOf('collateral') >= 0) return 0.32;
    if (x.indexOf('yield') >= 0 || x.indexOf('leveraged farm') >= 0 || x.indexOf('farm') >= 0) return 0.30;
    if (x.indexOf('risk curator') >= 0 || x.indexOf('allocator') >= 0 || x.indexOf('collateral management') >= 0) return 0.30;
    if (x.indexOf('basis trading') >= 0) return 0.30;
    if (x.indexOf('restak') >= 0 || x.indexOf('staking pool') >= 0) return 0.28;
    if (x.indexOf('insurance') >= 0) return 0.28;
    if (x.indexOf('bridge') >= 0) return 0.15;
    if (x.indexOf('stable') >= 0) return 0.22;
    return 0.25;
  }

  /* ---------- filtering & sorting ---------- */
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.wl && !watch[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      var d = 0;
      if (key === 'rank') d = a.rank - b.rank;
      else if (key === 'value') d = b.implied_value_usd - a.implied_value_usd;
      else if (key === 'tvl') d = b.tvl_usd - a.tvl_usd;
      else if (key === 'growth') d = (b.change_7d == null ? -9999 : b.change_7d) - (a.change_7d == null ? -9999 : a.change_7d);
      else if (key === 'age') d = (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days);
      else if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      return d * state.dir;
    });
    return out;
  }

  /* ---------- shared chrome ---------- */
  function totalImplied() {
    var t = 0;
    rows.forEach(function (r) { t += r.implied_value_usd; });
    return t;
  }
  function medianGrowth() {
    var g = rows.map(function (r) { return r.change_7d; }).filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
    return g.length ? g[Math.floor(g.length / 2)] : null;
  }
  function header() {
    var mg = medianGrowth();
    return '<header class="hero">' +
      '<div class="eyebrow">Token Radar · model radar-2 · snapshot ' + esc(D.as_of) + '</div>' +
      '<h1>Protocols without a token, <span class="thin">ranked by what their launch would be worth</span></h1>' +
      '<p class="lede">Every protocol below <b>records no token</b> in the sealed snapshot and is not a wrapped, staked or bridged product of one that already trades. The board ranks them by an <b>implied value</b> built only from the snapshot: TVL, seven-day growth, age, category and chains. Each row carries a farm plan: concrete steps, with a cost and a time.</p>' +
      '<div class="stats">' +
      '<div class="stat"><div class="k">Watchlist</div><div class="v">' + D.watchlist_size + '</div><div class="s">protocols at or above the $50M floor</div></div>' +
      '<div class="stat"><div class="k">Board rows</div><div class="v">' + D.board_size + '</div><div class="s">' + D.early_size + ' found below the floor</div></div>' +
      '<div class="stat"><div class="k">Total implied value</div><div class="v">' + money(totalImplied()) + '</div><div class="s">across the whole board</div></div>' +
      '<div class="stat"><div class="k">Median 7-day TVL change</div><div class="v">' + (mg == null ? 'n/a' : (mg > 0 ? '+' : '') + mg.toFixed(1) + '%') + '</div><div class="s">most of the board is shrinking</div></div>' +
      '</div>' +
      '<nav class="tabs" role="tablist">' +
      '<button class="tab" data-tab="board" role="tab" aria-selected="' + (state.tab === 'board') + '">Board <span class="n">' + D.board_size + '</span></button>' +
      '<button class="tab" data-tab="live" role="tab" aria-selected="' + (state.tab === 'live') + '">Live tokens <span class="n">' + D.live_size + '</span></button>' +
      '<button class="tab" data-tab="model" role="tab" aria-selected="' + (state.tab === 'model') + '">The model</button>' +
      '</nav></header>';
  }
  function footer() {
    return '<footer>Source: a sealed snapshot fetched once from DefiLlama&#8217;s public protocols list on ' + esc(D.as_of) + ' (floor $50,000,000; ' + D.watchlist_size + ' protocols on the watchlist of 758 tracked). ' +
      '<b>Implied values are this entry&#8217;s own claim</b>, built from the snapshot alone; they are not a prediction that a token will launch, or when. A protocol listed here records no token — that is not proof it has none.</footer>';
  }

  /* ---------- board tab ---------- */
  function boardView() {
    var cats = [], chains = [];
    rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
      (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    cats.sort(); chains.sort();
    var list = filtered();
    var h = '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(state.q) + '" aria-label="Search">' +
      '<select id="cat" aria-label="Category"><option value="">All categories</option>' +
      cats.map(function (c) { return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="chain" aria-label="Chain"><option value="">All chains</option>' +
      chains.map(function (c) { return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<label class="check"><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<select id="sort" aria-label="Sort by">' +
      [['rank', 'Sort: rank'], ['value', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['name', 'Sort: name']].map(function (o) {
        return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' +
      '<span class="count"><b>' + list.length + '</b> of ' + rows.length + ' rows</span></div>';
    if (!list.length) return h + '<p class="empty">Nothing matches those filters. Clear the search or widen the category.</p>';
    h += '<div id="board"><table><thead><tr>' +
      '<th class="num sortable" data-sort="rank">Rank</th><th class="sortable" data-sort="name">Protocol</th>' +
      '<th class="sortable cat" data-sort="cat">Category</th><th>Chains</th>' +
      '<th class="num sortable" data-sort="tvl">TVL</th><th class="num sortable" data-sort="growth">7d</th>' +
      '<th class="num sortable hide-m" data-sort="age">Age</th><th class="num sortable" data-sort="value">Implied value</th></tr></thead><tbody>';
    list.forEach(function (r) {
      h += '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank num' + (r.rank <= 3 ? ' top' : '') + '">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + (watch[r.slug] ? '<span class="badge wl">Watchlist</span>' : '') + '</span><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td>' + chainsHtml(r.chains) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num hide-m">' + ageStr(r.age_days) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- detail view ---------- */
  function detailView(r) {
    var steps = (r.farm_steps || []).map(function (s, i) {
      var m = s.match(/ Cost: (.*)\. Time: (.*)\.$/);
      var text = s, meta = '';
      if (m) { text = s.slice(0, m.index); meta = 'Cost: ' + m[1] + ' · Time: ' + m[2]; }
      return '<li><span class="t">' + esc(text) + '</span>' + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</li>';
    }).join('');
    var base = Math.round(r.tvl_usd * r.category_multiple);
    return '<section class="detail"><button class="back" id="back">← Back to the board</button>' +
      '<h2>' + esc(r.name) + (watch[r.slug] ? '<span class="badge wl">Watchlist</span>' : '') + '</h2>' +
      '<p class="sub"><code>' + esc(r.slug) + '</code> · ' + esc(r.category || 'no category') + ' · ' + (r.chains || []).map(esc).join(', ') + ' · tracked since ' + esc(r.listed_at || 'unknown') + '</p>' +
      '<div class="dgrid">' +
      '<div class="stat"><div class="k">Rank</div><div class="v">#' + r.rank + ' of ' + rows.length + '</div><div class="s">by implied value</div></div>' +
      '<div class="stat"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div><div class="s">' + moneyFull(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div><div class="s">7d ' + (r.change_7d == null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div></div>' +
      '<div class="stat"><div class="k">Age</div><div class="v">' + ageStr(r.age_days) + '</div><div class="s">' + (r.age_days == null ? 'listing date unreported' : r.age_days + ' days tracked') + '</div></div>' +
      '</div>' +
      '<div class="modelbox"><h3>How the value is built — model radar-2</h3>' +
      '<div class="formula">implied = TVL × category multiple × growth × maturity × chains</div>' +
      '<table><tbody>' +
      '<tr><td>TVL × category multiple (' + (r.category || 'other') + ' × ' + r.category_multiple.toFixed(2) + ')</td><td>' + moneyFull(base) + '</td></tr>' +
      '<tr><td>Growth multiplier (7d ' + (r.change_7d == null ? 'unreported' : r.change_7d.toFixed(1) + '%') + ')</td><td>× ' + r.growth_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td>Maturity multiplier (' + ageStr(r.age_days) + ' old)</td><td>× ' + r.maturity_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td>Chains multiplier (' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + ')</td><td>× ' + r.chains_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td><b>Implied value</b></td><td><b>' + moneyFull(r.implied_value_usd) + '</b></td></tr>' +
      '</tbody></table></div>' +
      '<div class="farm"><h3>Farm plan — seven steps</h3><ol>' + steps + '</ol></div>' +
      '<p class="note">This protocol <b>records no token</b> in the sealed snapshot. That is not proof it has none — and it is not a promise it will ever issue one. Farm only money you can afford to leave in the position, and claim only from links the protocol itself publishes.</p>' +
      '</section>';
  }

  /* ---------- live tab ---------- */
  function liveView() {
    var h = '<p class="lede" style="margin-top:4px">These protocols <b>already have a token that trades</b>, so the board does not rank them: their market cap is the market&#8217;s own value, not a model&#8217;s. They are here so the radar shows its work — what is still to come, and what has already come.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">7d</th></tr></thead><tbody>';
    live.forEach(function (p) {
      h += '<tr><td><span class="name">' + esc(p.name) + '<span class="badge live">Live</span></span><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td class="cat">' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num val">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  /* ---------- model tab ---------- */
  function modelView() {
    var mults = [['Perpetuals &amp; derivatives', '0.50'], ['DEXs', '0.38'], ['RWA', '0.35'], ['Lending, CDP &amp; collateral', '0.32'],
      ['Yield, leveraged farming &amp; farms', '0.30'], ['Risk curators &amp; allocators', '0.30'], ['Basis trading', '0.30'],
      ['Restaking &amp; staking pools', '0.28'], ['Insurance', '0.28'], ['Everything else', '0.25'], ['Stablecoin wrappers', '0.22'], ['Bridges', '0.15']];
    return '<section class="modeltab"><h2>The model — radar-2</h2>' +
      '<p>Implied value is built only from the snapshot&#8217;s own figures. No protocol name is ever special-cased: the same function scores every row, and the detail view of any protocol shows its own arithmetic.</p>' +
      '<div class="formula">implied = TVL × category multiple × growth × maturity × chains</div>' +
      '<table><thead><tr><th>Piece</th><th>Value</th></tr></thead><tbody>' +
      '<tr><td>Category multiple — the fraction of secured value a launch usually prices at, by what the protocol does</td><td>0.15 – 0.50</td></tr>' +
      '<tr><td>Growth — 7-day TVL change, clamped to −80%…+200%; gains count at 0.6, losses in full</td><td>0.20 – 2.20</td></tr>' +
      '<tr><td>Maturity — 0.70 at listing, rising to 1.00 at 3 years, easing to 0.90 past 6; unknown age counts as 365 days</td><td>0.70 – 1.00</td></tr>' +
      '<tr><td>Chains — +0.02 per extra chain, capped at five</td><td>1.00 – 1.10</td></tr>' +
      '</tbody></table>' +
      '<h2>Category multiples</h2><table><thead><tr><th>Category family</th><th>Multiple</th></tr></thead><tbody>' +
      mults.map(function (m) { return '<tr><td>' + m[0] + '</td><td>' + m[1] + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<h2>How the board is built</h2>' +
      '<p><b>1. Who ranks.</b> The 40 protocols on the watchlist, plus every pre-token protocol below the $50M floor that passes the same visible rule — not a wrapped, staked or bridged product, not an exchange, not a versioned pool. A protocol above the floor that the watchlist leaves out stays out: the house&#8217;s rule saw something this file cannot (a parent protocol), and the board does not second-guess it.</p>' +
      '<p><b>2. Who does not rank.</b> Protocols whose token already trades are set aside in the Live tab, at their market cap. Exchanges, wrapped and staked products, and versioned pools are not launch candidates and never appear on the board.</p>' +
      '<p><b>3. Farm plans.</b> Seven steps per protocol, derived from its category, chains, TVL and age — the action, what it costs, how long it takes. No slogans: a step that cannot be followed is not a step.</p>' +
      '<p><b>4. What this is not.</b> The snapshot says nothing about whether or when a token launches. Implied value is the entry&#8217;s own claim about what a launch would be worth if the protocol&#8217;s record stayed as it is.</p></section>';
  }

  /* ---------- render & events ---------- */
  function render() {
    app.setAttribute('aria-busy', 'false');
    var h = '<div class="wrap' + (state.sel ? ' detail-open' : '') + '">' + header();
    if (state.sel && bySlug[state.sel]) h += detailView(bySlug[state.sel]);
    if (state.tab === 'board') h += boardView();
    else if (state.tab === 'live') h += liveView();
    else h += modelView();
    h += footer() + '</div>';
    app.innerHTML = h;
    bind();
  }
  function bind() {
    var tabs = app.querySelectorAll('.tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () { state.tab = t.getAttribute('data-tab'); state.sel = null; setHash(''); render(); });
    });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; renderBoardOnly(); });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.cat = cat.value; render(); });
    var ch = document.getElementById('chain');
    if (ch) ch.addEventListener('change', function () { state.chain = ch.value; render(); });
    var wl = document.getElementById('wl');
    if (wl) wl.addEventListener('change', function () { state.wl = wl.checked; render(); });
    var sort = document.getElementById('sort');
    if (sort) sort.addEventListener('change', function () { state.sort = sort.value; state.dir = 1; render(); });
    app.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        var map = { rank: 'rank', name: 'name', cat: 'name', tvl: 'tvl', growth: 'growth', age: 'age', value: 'value' };
        var s = map[k] || 'rank';
        if (state.sort === s) state.dir = -state.dir; else { state.sort = s; state.dir = 1; }
        render();
      });
    });
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { state.sel = tr.getAttribute('data-slug'); setHash('#/p/' + state.sel); render(); window.scrollTo(0, 0); });
    });
    var back = document.getElementById('back');
    if (back) back.addEventListener('click', function () { state.sel = null; setHash(''); render(); });
  }
  function renderBoardOnly() {
    // Re-render the table region without losing the search box focus.
    var pos = document.getElementById('q');
    var start = pos ? pos.selectionStart : 0;
    render();
    var q2 = document.getElementById('q');
    if (q2) { q2.focus(); q2.setSelectionRange(start, start); }
  }
  function setHash(h) {
    try { history.replaceState(null, '', h || location.pathname + location.search); } catch (e) { /* file:// */ }
  }
  function readHash() {
    var h = location.hash || '';
    var m = h.match(/^#\/p\/([A-Za-z0-9._-]+)$/);
    if (m && bySlug[m[1]]) { state.sel = m[1]; state.tab = 'board'; return; }
    var f = h.match(/^#\/f\/(.+)$/);
    if (f) {
      var v = decodeURIComponent(f[1]);
      if (v === 'watchlist') state.wl = true;
      else state.cat = v;
      state.tab = 'board';
    }
  }
  readHash();
  window.addEventListener('hashchange', function () {
    state.sel = null; state.cat = ''; state.wl = false; state.q = ''; state.chain = '';
    readHash();
    render();
    window.scrollTo(0, 0);
  });
  render();
})();
