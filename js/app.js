// app.js: UI for the IDA PBA explorer. Model logic lives in model.js.

(() => {
  const M = window.PBAModel;
  const T = window.CGDTracking;
  // Cache-busting version stamped on this script's URL by scripts/bump-version.py
  const VERSION = document.currentScript && new URL(document.currentScript.src).searchParams.get('v');

  const COLORS = {
    teal: '#0B4C5B', lightTeal: '#006970', gold: '#FFB52C', tealGray: '#85A5AD',
    tealBlack: '#1A272A', lightGray: '#DFE0E2', blue: '#2D99B5'
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = id => document.getElementById(id);
  const fmt = (x, d = 1) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtSigned = (x, d = 1) => {
    const r = +x.toFixed(d);
    return (r > 0 ? '+' : r < 0 ? '−' : '') + fmt(Math.abs(r), d);
  };
  const fmtExp = x => (x < 0 ? '−' : '') + Math.abs(x).toFixed(3).replace(/0$/, '');
  const fmtUsd = x => '$' + Math.round(x).toLocaleString('en-US');

  let DATA, C, FY25, TOTAL;
  let baseline;          // results under the FY25 formula
  let current;           // results under the user's settings
  const charts = {};
  let equiv_point = null; // marker for the equivalence chart

  const state = {
    expGni: -0.125, expCpr: 3, base: 15, cutoffOn: false, cutoff: 4000,
    povLine: null, xAxis: 'gnipc', metric: 'pct',
    sort: { key: 'pct', dir: 'desc' }
  };
  // GNI per capita multiplier slider: factor = 10^(v/500), so v = 0 is exactly x1,
  // v = 500 is x10 and v = -301 is x0.25
  const GNI_MIN = 0.25, GNI_MAX = 10;
  const sliderToFactor = v => Math.pow(10, v / 500);
  const tab2 = { index: 0, mode: 'gni', gniFactor: sliderToFactor(21), cprDelta: 0.1, basis: 'fy25' };

  function params() {
    return {
      expGni: state.expGni, expCpr: state.expCpr, base: state.base,
      cutoff: state.cutoffOn ? state.cutoff : null,
      total: TOTAL, pakCap: FY25.pak_cap
    };
  }
  function fy25Params() {
    return { expGni: FY25.exp_gni, expCpr: FY25.exp_cpr, base: FY25.base, cutoff: null, total: TOTAL, pakCap: FY25.pak_cap };
  }

  // ------------------------------------------------------------------ setup

  fetch('data/pba.json' + (VERSION ? '?v=' + VERSION : ''))
    .then(r => r.json())
    .then(init)
    .catch(err => {
      document.querySelector('.wrap').insertAdjacentHTML('afterbegin',
        '<p class="warn">Sorry, the data could not be loaded.</p>');
      console.error(err);
    });

  function init(data) {
    DATA = data;
    C = data.countries;
    FY25 = data.meta.fy25;
    TOTAL = data.meta.total_allocation;
    state.povLine = String(data.meta.poverty_lines[0]);
    baseline = M.run(C, fy25Params());

    setupChartDefaults();
    setupTabs();
    setupFormulaControls();
    setupPovertyLines();
    setupTable();
    setupCountryTab();

    $('n-countries').textContent = C.length;
    $('pov-year').textContent = data.meta.poverty_year;
    const imputed = C.filter(c => c.gnipc_imputed || c.cpr_imputed).map(c => c.country);
    if (imputed.length) {
      $('imputed-note').textContent = 'GNI per capita or CPR is not published for ' + imputed.join(', ') +
        '; these are backed out from the published allocation.';
    }

    updateFormula();
    updateCountry();
    T.trackView();
  }

  function setupChartDefaults() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = COLORS.tealBlack;
    Chart.defaults.animation.duration = reducedMotion ? 0 : 250;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = COLORS.tealBlack;
  }

  // ------------------------------------------------------------------ tabs

  function setupTabs() {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    function select(tab, focus) {
      tabs.forEach(t => {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        $(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        if (tab.getAttribute('aria-selected') === 'true') return;
        select(tab);
        if (tab.id === 'tab-country') updateCountry();
        T.trackEngagement('navigate', 'section_tab', tab.id === 'tab-formula' ? 'change_formula' : 'change_country');
      });
      tab.addEventListener('keydown', e => {
        let j = null;
        if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
        if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        if (e.key === 'Home') j = 0;
        if (e.key === 'End') j = tabs.length - 1;
        if (j !== null) { e.preventDefault(); tabs[j].click(); tabs[j].focus(); }
      });
    });
  }

  // ------------------------------------------------------------------ tab 1: controls

  let timer;
  function debounced(fn) { clearTimeout(timer); timer = setTimeout(fn, 60); }

  function setupFormulaControls() {
    const bind = (id, key, label) => {
      const el = $(id);
      el.addEventListener('input', () => { state[key] = +el.value; showValues(); debounced(updateFormula); });
      el.addEventListener('change', () => T.trackEngagement('filter', label, el.value));
    };
    bind('exp-gni', 'expGni', 'gni_exponent_slider');
    bind('exp-cpr', 'expCpr', 'cpr_exponent_slider');
    bind('base', 'base', 'base_allocation_slider');
    bind('cutoff', 'cutoff', 'gni_cutoff_slider');

    $('cutoff-on').addEventListener('change', e => {
      state.cutoffOn = e.target.checked;
      $('cutoff').disabled = !state.cutoffOn;
      showValues(); updateFormula();
      T.trackEngagement('filter', 'gni_cutoff_toggle', state.cutoffOn ? 'on' : 'off');
    });

    $('reset').addEventListener('click', () => {
      Object.assign(state, { expGni: FY25.exp_gni, expCpr: FY25.exp_cpr, base: FY25.base, cutoffOn: false });
      $('exp-gni').value = state.expGni; $('exp-cpr').value = state.expCpr; $('base').value = state.base;
      $('cutoff-on').checked = false; $('cutoff').disabled = true;
      showValues(); updateFormula();
      T.trackEngagement('preset', 'reset_fy25');
    });

    segmented('xaxis', v => { state.xAxis = v; updateScatter(); T.trackEngagement('view_control', 'scatter_x_axis', v); });
    segmented('metric', v => { state.metric = v; updateScatter(); updateMovers(); T.trackEngagement('view_control', 'change_metric', v); });

    $('download').addEventListener('click', downloadCsv);
    showValues();
  }

  function segmented(id, onChange) {
    const buttons = [...$(id).querySelectorAll('button')];
    buttons.forEach(b => b.addEventListener('click', () => {
      buttons.forEach(o => o.setAttribute('aria-pressed', o === b));
      onChange(b.dataset.v);
    }));
  }

  function showValues() {
    $('exp-gni-val').textContent = fmtExp(state.expGni);
    $('exp-cpr-val').textContent = state.expCpr.toFixed(1);
    $('base-val').textContent = 'SDR ' + state.base + 'm';
    $('cutoff-val').textContent = state.cutoffOn ? fmtUsd(state.cutoff) : 'none';
    $('sup-gni').textContent = fmtExp(state.expGni);
    $('sup-cpr').textContent = +state.expCpr.toFixed(1);
  }

  function setupPovertyLines() {
    const lines = DATA.meta.poverty_lines;
    const sel = $('povline');
    sel.innerHTML = lines.map(l => `<option value="${l}">Poverty line: $${(+l).toFixed(2)} a day</option>`).join('');
    if (lines.length > 1) {
      $('povline-wrap').hidden = false;
      sel.addEventListener('change', () => {
        state.povLine = sel.value;
        updateFormula();
        T.trackEngagement('filter', 'poverty_line_select', sel.value);
      });
    }
  }

  // ------------------------------------------------------------------ tab 1: update

  function rows() {
    return C.map((c, i) => {
      const b = baseline[i].alloc, n = current[i].alloc;
      return {
        i, country: c.country, gnipc: c.gnipc, cpr: c.cpr, pov: c.pov[state.povLine],
        base: b, now: n, abs: n - b, pct: b > 0 ? (n / b - 1) * 100 : 0,
        eligible: current[i].eligible
      };
    });
  }

  function updateFormula() {
    current = M.run(C, params());
    const R = rows();
    document.querySelectorAll('.povline-text').forEach(el => el.textContent = '$' + (+state.povLine).toFixed(2).replace(/\.00$/, ''));
    updateStats(R);
    updateScatter(R);
    updateMovers(R);
    updateCorr();
    updateTable(R);
    if (tab2.basis === 'mine') updateCountry();
  }

  function updateStats(R) {
    const gain = R.filter(r => r.abs > 0.05).length;
    const lose = R.filter(r => r.abs < -0.05).length;
    const excl = R.filter(r => !r.eligible).length;
    const moved = R.reduce((s, r) => s + Math.max(r.abs, 0), 0);
    const pctMoved = moved / TOTAL * 100;
    $('stats').innerHTML = [
      [gain, 'countries gain'],
      [lose, 'countries lose'],
      [excl, 'excluded by cutoff'],
      ['SDR ' + fmt(moved, 0) + 'm', `reallocated (${fmt(pctMoved, 1)}% of the total)`]
    ].map(([n, l]) => `<div class="stat"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');
  }

  function pointColor(r) {
    if (!r.eligible) return COLORS.tealGray;
    return r.abs >= 0 ? COLORS.lightTeal : COLORS.gold;
  }

  const X_AXES = {
    gnipc: { label: 'GNI per capita (US$, log scale)', type: 'logarithmic', get: r => r.gnipc, tick: v => fmtUsd(v) },
    cpr: { label: 'Country Performance Rating (CPR)', type: 'linear', get: r => r.cpr, tick: v => v },
    pov: { label: 'Poverty rate', type: 'linear', get: r => r.pov * 100, tick: v => v + '%' }
  };

  function updateScatter(R = rows()) {
    const ax = X_AXES[state.xAxis];
    const yKey = state.metric;
    const pts = R.map(r => ({ x: ax.get(r), y: r[yKey], r }));
    const yLabel = yKey === 'pct' ? 'Change in allocation (%)' : 'Change in allocation (SDR m)';

    if (!charts.scatter) {
      charts.scatter = new Chart($('scatter'), {
        type: 'scatter',
        data: { datasets: [{ data: pts, pointRadius: 5, pointHoverRadius: 7, borderWidth: 0 }] },
        options: {
          maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, color: COLORS.teal } , grid: { display: false }, border: { color: COLORS.tealBlack } },
            y: {
              grid: { color: ctx => ctx.tick.value === 0 ? COLORS.tealBlack : COLORS.lightGray },
              border: { display: false }
            }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: ctx => {
                  const r = ctx.raw.r;
                  return [
                    r.country,
                    `SDR ${fmt(r.base)}m → ${fmt(r.now)}m (${fmtSigned(r.pct)}%)`,
                    `GNI pc ${fmtUsd(r.gnipc)} · CPR ${r.cpr.toFixed(2)} · poverty ${fmt(r.pov * 100)}%`
                  ];
                }
              }
            }
          }
        }
      });
    }
    const ch = charts.scatter;
    const ds = ch.data.datasets[0];
    ds.data = pts;
    ds.backgroundColor = pts.map(p => pointColor(p.r));
    ch.options.scales.x.type = ax.type;
    ch.options.scales.x.title.text = ax.label;
    ch.options.scales.x.ticks = { callback: ax.tick, maxTicksLimit: 8, autoSkip: true };
    if (ax.type === 'logarithmic') {
      ch.options.scales.x.ticks.callback = v => [200, 500, 1000, 2000, 5000, 10000, 20000].includes(v) ? fmtUsd(v) : '';
    }
    $('scatter-ylabel').textContent = yLabel;
    ch.options.scales.y.ticks = { callback: v => yKey === 'pct' ? v + '%' : fmt(v, 0) };
    ch.update();
  }

  function updateMovers(R = rows()) {
    const key = state.metric;
    const sorted = [...R].sort((a, b) => b[key] - a[key]);
    const changed = sorted.filter(r => Math.abs(r.abs) > 0.05);
    let top = changed.filter(r => r[key] > 0).slice(0, 10);
    let bottom = changed.filter(r => r[key] < 0).slice(-10);
    const list = top.concat(bottom);

    if (!charts.movers) {
      charts.movers = new Chart($('movers'), {
        type: 'bar',
        data: { labels: [], datasets: [{ data: [], borderWidth: 0, barPercentage: 0.85, categoryPercentage: 0.9 }] },
        options: {
          indexAxis: 'y',
          maintainAspectRatio: false,
          scales: {
            x: { grid: { color: ctx => ctx.tick.value === 0 ? COLORS.tealBlack : COLORS.lightGray }, border: { display: false } },
            y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 12 } } }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: ctx => {
                  const r = list[ctx.dataIndex];
                  return `SDR ${fmt(r.base)}m → ${fmt(r.now)}m (${fmtSigned(r.abs)}m, ${fmtSigned(r.pct)}%)`;
                }
              }
            }
          }
        }
      });
    }
    const ch = charts.movers;
    ch.data.labels = list.length ? list.map(r => r.country) : ['No change from the FY25 formula'];
    ch.data.datasets[0].data = list.map(r => r[key]);
    ch.data.datasets[0].backgroundColor = list.map(pointColor);
    ch.options.scales.x.ticks = { callback: v => key === 'pct' ? v + '%' : fmt(v, 0) };
    ch.options.scales.x.title = { display: true, color: COLORS.teal, text: key === 'pct' ? 'Change in allocation (%)' : 'Change in allocation (SDR m)' };
    ch.update();
  }

  function updateCorr() {
    const before = M.povertyCorrelations(C, baseline, state.povLine);
    const after = M.povertyCorrelations(C, current, state.povLine);

    if (!charts.corr) {
      charts.corr = new Chart($('corr'), {
        type: 'bar',
        data: {
          labels: before.map(m => m.label),
          datasets: [
            { label: 'FY25 formula', data: [], backgroundColor: COLORS.tealGray, borderWidth: 0 },
            { label: 'Your settings', data: [], backgroundColor: COLORS.lightTeal, borderWidth: 0 }
          ]
        },
        options: {
          maintainAspectRatio: false,
          scales: {
            y: { grid: { color: ctx => ctx.tick.value === 0 ? COLORS.tealBlack : COLORS.lightGray }, border: { display: false } },
            x: { grid: { display: false } }
          },
          plugins: {
            legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12 } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(3)}` } }
          }
        }
      });
    }
    const ch = charts.corr;
    ch.data.datasets[0].data = before.map(m => m.r);
    ch.data.datasets[1].data = after.map(m => m.r);
    ch.update();

    $('corr-table').querySelector('tbody').innerHTML = before.map((m, k) => {
      const d = after[k].r - m.r;
      const cls = Math.abs(d) < 0.0005 ? 'muted' : d > 0 ? 'pos' : 'neg';
      return `<tr><td>${m.label}</td><td>${m.r.toFixed(3)}</td><td>${after[k].r.toFixed(3)}</td><td class="${cls}">${fmtSigned(d, 3)}</td></tr>`;
    }).join('');
  }

  // ------------------------------------------------------------------ tab 1: table

  const COLS = [
    { key: 'country', label: 'Country', fmt: r => r.country },
    { key: 'gnipc', label: 'GNI pc (US$)', fmt: r => fmtUsd(r.gnipc) },
    { key: 'cpr', label: 'CPR', fmt: r => r.cpr.toFixed(2) },
    { key: 'pov', label: 'Poverty rate', fmt: r => fmt(r.pov * 100) + '%' },
    { key: 'base', label: 'FY25 formula', fmt: r => fmt(r.base) },
    { key: 'now', label: 'Your settings', fmt: r => r.eligible ? fmt(r.now) : '0.0 (excluded)' },
    { key: 'abs', label: 'Change', fmt: r => fmtSigned(r.abs), cls: r => r.abs > 0.05 ? 'pos' : r.abs < -0.05 ? 'neg' : 'muted' },
    { key: 'pct', label: 'Change (%)', fmt: r => fmtSigned(r.pct) + '%', cls: r => r.abs > 0.05 ? 'pos' : r.abs < -0.05 ? 'neg' : 'muted' }
  ];

  function setupTable() {
    const tr = $('country-table').querySelector('thead tr');
    tr.innerHTML = COLS.map(c => `<th scope="col" data-key="${c.key}"><button type="button">${c.label}</button></th>`).join('');
    tr.querySelectorAll('th').forEach(th => th.querySelector('button').addEventListener('click', () => {
      const key = th.dataset.key;
      state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'desc' ? 'asc' : (key === 'country' && state.sort.key !== key ? 'asc' : 'desc') };
      updateTable();
      T.trackEngagement('view_control', 'table_sort', key);
    }));
  }

  function updateTable(R = rows()) {
    const { key, dir } = state.sort;
    const s = dir === 'asc' ? 1 : -1;
    R.sort((a, b) => key === 'country' ? s * a.country.localeCompare(b.country) : s * (a[key] - b[key]));
    $('country-table').querySelectorAll('th').forEach(th => {
      if (th.dataset.key === key) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    $('country-table').querySelector('tbody').innerHTML = R.map(r =>
      '<tr>' + COLS.map((c, k) => {
        const tag = k === 0 ? 'th scope="row"' : 'td';
        const cls = c.cls ? ` class="${c.cls(r)}"` : '';
        return `<${tag}${cls}>${escapeHtml(c.fmt(r))}</${tag.split(' ')[0]}>`;
      }).join('') + '</tr>'
    ).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function downloadCsv() {
    const p = params();
    const header = ['country', 'iso3', 'gni_per_capita_usd', 'cpr', 'poverty_rate_' + state.povLine, 'fy25_formula_sdr_m',
      'your_settings_sdr_m', 'change_sdr_m', 'change_pct', 'excluded_by_cutoff'];
    const lines = [
      `# IDA PBA explorer. Settings: GNI exponent ${p.expGni}; CPR exponent ${p.expCpr}; base SDR ${p.base}m; GNI cutoff ${p.cutoff == null ? 'none' : p.cutoff}`,
      header.join(',')
    ];
    rows().forEach(r => {
      const c = C[r.i];
      lines.push([`"${c.country}"`, c.iso3, c.gnipc, c.cpr.toFixed(4), r.pov, r.base.toFixed(2), r.now.toFixed(2),
        r.abs.toFixed(2), r.pct.toFixed(2), !r.eligible].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ida-pba-explorer.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    T.trackEngagement('download', 'results_csv');
  }

  // ------------------------------------------------------------------ tab 2

  function setupCountryTab() {
    const sel = $('country');
    const order = C.map((c, i) => i).sort((a, b) => C[a].country.localeCompare(C[b].country));
    sel.innerHTML = order.map(i => `<option value="${i}">${escapeHtml(C[i].country)}</option>`).join('');
    tab2.index = Math.max(0, C.findIndex(c => c.iso3 === 'GHA'));
    sel.value = tab2.index;
    sel.addEventListener('change', () => {
      tab2.index = +sel.value;
      updateCountry();
      T.trackEngagement('filter', 'country_select', C[tab2.index].country);
    });

    document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', () => {
      tab2.mode = r.value;
      $('gni-ctrl').hidden = tab2.mode !== 'gni';
      $('cpr-ctrl').hidden = tab2.mode !== 'cpr';
      updateCountry();
      T.trackEngagement('filter', 'change_variable', tab2.mode);
    }));
    document.querySelectorAll('input[name="basis"]').forEach(r => r.addEventListener('change', () => {
      tab2.basis = r.value;
      updateCountry();
      T.trackEngagement('filter', 'formula_basis', tab2.basis);
    }));

    const g = $('gni-factor');
    g.addEventListener('input', () => { tab2.gniFactor = sliderToFactor(+g.value); updateCountry(); });
    g.addEventListener('change', () => T.trackEngagement('filter', 'gni_multiplier_slider', tab2.gniFactor.toFixed(2)));
    $('reset-country').addEventListener('click', () => {
      tab2.gniFactor = 1;
      tab2.cprDelta = 0;
      g.value = 0;
      updateCountry();
      T.trackEngagement('preset', 'reset_country_change');
    });

    const d = $('cpr-delta');
    d.addEventListener('input', () => { tab2.cprDelta = +d.value; updateCountry(); });
    d.addEventListener('change', () => T.trackEngagement('filter', 'cpr_change_slider', tab2.cprDelta.toFixed(2)));
  }

  function updateCountry() {
    if (!C) return;
    const i = tab2.index, c = C[i];
    const p = tab2.basis === 'mine' ? params() : fy25Params();
    const before = M.run(C, p)[i];

    // Keep the CPR slider within the 1-6 scale for this country
    const d = $('cpr-delta');
    d.min = Math.max(-1.5, Math.ceil((1 - c.cpr) * 100) / 100);
    d.max = Math.min(1.5, Math.floor((6 - c.cpr) * 100) / 100);
    tab2.cprDelta = Math.min(Math.max(tab2.cprDelta, +d.min), +d.max);
    d.value = tab2.cprDelta;

    const factor = tab2.gniFactor;
    $('gni-factor-val').textContent = factor.toFixed(2) + ` (${fmtSigned((factor - 1) * 100, 0)}%)`;
    $('cpr-delta-val').textContent = fmtSigned(tab2.cprDelta, 2);

    document.querySelectorAll('.country-name').forEach(el => el.textContent = c.country);
    document.querySelectorAll('.c-exp').forEach(el => el.textContent = +p.expCpr.toFixed(1));
    document.querySelectorAll('.g-exp').forEach(el => el.textContent = fmtExp(p.expGni));
    $('country-facts').textContent = `GNI per capita ${fmtUsd(c.gnipc)}${c.gnipc_imputed ? ' (backed out)' : ''} · CPR ${c.cpr.toFixed(2)}${c.cpr_imputed ? ' (backed out)' : ''} · population ${fmt(c.pop)}m`;
    $('basis-hint').textContent = tab2.basis === 'mine'
      ? `GNI exponent ${fmtExp(p.expGni)}, CPR exponent ${+p.expCpr.toFixed(1)}, base SDR ${p.base}m, cutoff ${p.cutoff == null ? 'none' : fmtUsd(p.cutoff)}`
      : 'GNI exponent −0.125, CPR exponent 3, base SDR 15m, no cutoff';

    let change, equiv, text, warn = [];
    const cutoffTxt = p.cutoff == null ? null : fmtUsd(p.cutoff);

    if (tab2.mode === 'gni') {
      change = { gniFactor: factor };
      const newGni = c.gnipc * factor;
      const delta = M.cprEquivalentOfGni(c.cpr, factor, p);
      const after = M.runWithChange(C, i, p, change)[i];
      text = `Multiplying ${c.country}'s GNI per capita by <strong>${factor.toFixed(2)}</strong> (${fmtUsd(c.gnipc)} → ${fmtUsd(newGni)}) ` +
        allocSentence(before, after);
      const crossesCutoff = p.cutoff != null && (c.gnipc < p.cutoff) !== (newGni < p.cutoff);
      if (!before.eligible && !after.eligible) {
        equiv = `${c.country} is above the ${cutoffTxt} cutoff before and after this change, so it receives nothing either way.`;
      } else if (crossesCutoff) {
        equiv = `This change moves ${c.country} across the ${cutoffTxt} GNI per capita cutoff, so no CPR change has the same effect.`;
      } else {
        const newCpr = c.cpr + delta;
        equiv = `The same effect would come from changing its CPR by <strong>${fmtSigned(delta, 3)}</strong> (${c.cpr.toFixed(2)} → ${newCpr.toFixed(2)}).`;
        if (newCpr < 1 || newCpr > 6) warn.push('That CPR would be outside the 1–6 scale.');
      }
      equiv_point = { x: factor, y: crossesCutoff ? null : delta };
    } else {
      change = { cprDelta: tab2.cprDelta };
      const f = M.gniEquivalentOfCpr(c.cpr, tab2.cprDelta, p);
      const after = M.runWithChange(C, i, p, change)[i];
      text = `Changing ${c.country}'s CPR by <strong>${fmtSigned(tab2.cprDelta, 2)}</strong> (${c.cpr.toFixed(2)} → ${(c.cpr + tab2.cprDelta).toFixed(2)}) ` +
        allocSentence(before, after);
      if (!before.eligible) {
        equiv = `${c.country} is above the ${cutoffTxt} cutoff, so a CPR change makes no difference to its allocation.`;
      } else {
        const newGni = c.gnipc * f;
        equiv = `The same effect would come from multiplying its GNI per capita by <strong>${fmtNum(f)}</strong> (${fmtUsd(c.gnipc)} → ${fmtUsd(newGni)}).`;
        if (p.cutoff != null && newGni >= p.cutoff) {
          warn.push(`In practice, that GNI per capita would put ${c.country} above the ${cutoffTxt} cutoff, and it would receive nothing.`);
        }
      }
      equiv_point = { x: f, y: tab2.cprDelta };
    }

    if (before.capped || c.iso3 === 'PAK') {
      warn.push('Pakistan is capped at 6.88% of the total, so changes that would raise its allocation above the cap have no effect. The equivalence still holds for its underlying score.');
    }

    $('result').innerHTML = `<p>${text}</p><p>${equiv}</p>` + warn.map(w => `<p class="warn">${w}</p>`).join('');
    updateEquivChart(c, p);
  }


  function fmtNum(f) {
    if (f >= 100) return Math.round(f).toLocaleString('en-US');
    if (f >= 10) return f.toFixed(1);
    return f.toFixed(2);
  }

  function allocSentence(before, after) {
    const b = before.alloc, a = after.alloc;
    const pct = b > 0 ? (a / b - 1) * 100 : null;
    const pctTxt = pct == null ? '' : ` (${fmtSigned(pct)}%)`;
    const diff = a - b;
    const tail = Math.abs(diff) < 0.05 ? 'no change.' : `${diff > 0 ? 'an increase' : 'a fall'} of SDR ${fmt(Math.abs(diff))}m.`;
    return `changes its allocation from SDR ${fmt(b)}m to <strong>SDR ${fmt(a)}m</strong>${pctTxt}: ${tail}`;
  }

  function updateEquivChart(c, p) {
    const curve = [];
    for (let k = 0; k <= 120; k++) {
      const f = GNI_MIN * Math.pow(GNI_MAX / GNI_MIN, k / 120);
      curve.push({ x: f, y: M.cprEquivalentOfGni(c.cpr, f, p) });
    }
    const point = equiv_point && equiv_point.y != null && isFinite(equiv_point.x) ? [equiv_point] : [];

    if (!charts.equiv) {
      charts.equiv = new Chart($('equiv'), {
        type: 'scatter',
        data: {
          datasets: [
            { data: [], showLine: true, borderColor: COLORS.lightTeal, borderWidth: 3, pointRadius: 0, pointHitRadius: 6 },
            { data: [], pointRadius: 8, pointHoverRadius: 9, backgroundColor: COLORS.gold, borderWidth: 0 }
          ]
        },
        options: {
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'logarithmic', min: GNI_MIN, max: GNI_MAX,
              title: { display: true, text: 'GNI per capita multiplier (log scale)', color: COLORS.teal },
              afterBuildTicks: axis => { axis.ticks = [0.25, 0.5, 1, 2, 5, 10].map(value => ({ value })); },
              ticks: { callback: v => '×' + v },
              grid: { color: ctx => ctx.tick.value === 1 ? COLORS.tealBlack : COLORS.lightGray },
              border: { display: false }
            },
            y: {
              grid: { color: ctx => ctx.tick.value === 0 ? COLORS.tealBlack : COLORS.lightGray },
              border: { display: false }
            }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: ctx => `GNI pc ×${ctx.raw.x.toFixed(2)} ≡ CPR ${fmtSigned(ctx.raw.y, 3)}`
              }
            }
          }
        }
      });
    }
    const ch = charts.equiv;
    ch.data.datasets[0].data = curve;
    ch.data.datasets[1].data = point;
    ch.update();
  }
})();
