// model.js
// IDA performance-based allocation (PBA) model, ported from WB_PBA.R.
//
//   raw_i   = CPR_i^expCpr * GNIpc_i^expGni * pop_i   (0 if GNIpc_i >= cutoff)
//   budget  = total - (eligible countries x base) - FCV of eligible countries
//   alloc_i = budget * raw_i / sum(raw) + base + FCV_i (0 if not eligible)
//
// Pakistan is capped at pakCap x total; any excess is shared among the other
// countries in proportion to their raw scores. The total envelope is fixed, so
// money freed by the cutoff (including base and FCV) goes back into the
// performance-based pot.

(() => {
  function run(countries, p) {
    const n = countries.length;
    const eligible = countries.map(c => p.cutoff == null || c.gnipc < p.cutoff);
    const raw = countries.map((c, i) =>
      eligible[i] ? Math.pow(c.cpr, p.expCpr) * Math.pow(c.gnipc, p.expGni) * c.pop : 0
    );

    let sumRaw = 0, nEligible = 0, fcvEligible = 0;
    for (let i = 0; i < n; i++) {
      if (!eligible[i]) continue;
      sumRaw += raw[i];
      nEligible += 1;
      fcvEligible += countries[i].fcv;
    }
    const budget = p.total - nEligible * p.base - fcvEligible;

    const alloc = countries.map((c, i) =>
      eligible[i] ? budget * raw[i] / sumRaw + p.base + c.fcv : 0
    );

    // Pakistan cap
    const pak = countries.findIndex(c => c.iso3 === 'PAK');
    let pakCapped = false;
    if (pak !== -1 && alloc[pak] > p.pakCap * p.total) {
      const excess = alloc[pak] - p.pakCap * p.total;
      alloc[pak] = p.pakCap * p.total;
      pakCapped = true;
      const sumRawOthers = sumRaw - raw[pak];
      for (let i = 0; i < n; i++) {
        if (i !== pak) alloc[i] += excess * raw[i] / sumRawOthers;
      }
    }

    return countries.map((c, i) => {
      const base = eligible[i] ? p.base : 0;
      const fcv = eligible[i] ? c.fcv : 0;
      return {
        eligible: eligible[i],
        raw: raw[i],
        alloc: alloc[i],
        base,
        fcv,
        pba: alloc[i] - base - fcv, // performance-based portion, after the cap
        capped: i === pak && pakCapped
      };
    });
  }

  function pearson(x, y) {
    const n = x.length;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return sxy / Math.sqrt(sxx * syy);
  }

  // Correlation of per-capita allocation with the poverty headcount, for each
  // of the four allocation measures. Countries excluded by the cutoff count as 0.
  const MEASURES = [
    { key: 'pba',  label: 'Formula only',      get: r => r.pba },
    { key: 'fcv',  label: 'Formula + FCV',     get: r => r.pba + r.fcv },
    { key: 'base', label: 'Formula + base',    get: r => r.pba + r.base },
    { key: 'all',  label: 'Formula + FCV + base', get: r => r.alloc }
  ];

  function povertyCorrelations(countries, results, povLine) {
    const pov = countries.map(c => c.pov[povLine]);
    return MEASURES.map(m => ({
      key: m.key,
      label: m.label,
      r: pearson(results.map((r, i) => m.get(r) / countries[i].pop), pov)
    }));
  }

  // Two changes have the same effect on a country's allocation when they give
  // it the same raw score (nothing else in the formula changes). So the
  // equivalence has a closed form rather than needing a goal seek:
  //   (CPR + d)^c * (GNI)^g = CPR^c * (GNI * f)^g
  //   d = CPR * (f^(g/c) - 1)      f = ((CPR + d) / CPR)^(c/g)
  function cprEquivalentOfGni(cpr, factor, p) {
    return cpr * (Math.pow(factor, p.expGni / p.expCpr) - 1);
  }

  function gniEquivalentOfCpr(cpr, delta, p) {
    return Math.pow((cpr + delta) / cpr, p.expCpr / p.expGni);
  }

  // Re-run the model with one country's CPR and/or GNI per capita changed.
  function runWithChange(countries, index, p, change) {
    const modified = countries.map((c, i) => i !== index ? c : Object.assign({}, c, {
      cpr: c.cpr + (change.cprDelta || 0),
      gnipc: c.gnipc * (change.gniFactor == null ? 1 : change.gniFactor)
    }));
    return run(modified, p);
  }

  window.PBAModel = {
    run, pearson, povertyCorrelations, MEASURES,
    cprEquivalentOfGni, gniEquivalentOfCpr, runWithChange
  };
})();
