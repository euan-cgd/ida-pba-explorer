# IDA Allocation Formula Explorer

An interactive tool for exploring the World Bank IDA performance-based allocation (PBA) formula, using FY25 inputs. Built to the [CGD Interactive Toolkit](https://github.com/center-for-global-development) standards as a static, iframe-embeddable page.

**Status:** draft, not yet signed off by CGD comms for embedding on cgdev.org.

## What it does

**Tab 1: Change the formula.** Users adjust:

- the exponent on GNI per capita (−1 to −0.125; FY25: −0.125)
- the exponent on CPR (1 to 4; FY25: 3)
- the base allocation per country (SDR 0–50m; FY25: SDR 15m)
- an optional GNI per capita cutoff, above which a country receives nothing (no PBA, base or FCV)

It shows which countries gain and lose compared with the FY25 formula, plotted against GNI per capita, CPR or poverty. It also shows how the correlation between allocation per person and the poverty rate changes, for four measures: the formula only, + FCV, + base, and + FCV + base.

**Tab 2: Change a country's data.** Users change one country's GNI per capita (multiplicative) or CPR (additive). The tool shows the effect on its allocation, and the change in the other variable that would have the same effect. This uses either the FY25 formula or the user's tab 1 settings.

## The model

For each eligible country *i*:

```
raw_i   = CPR_i ^ e_cpr  ×  GNIpc_i ^ e_gni  ×  pop_i
budget  = total envelope − (number of eligible countries × base) − FCV of eligible countries
alloc_i = budget × raw_i / Σ raw  +  base  +  FCV_i
```

- **Fixed envelope:** the total (SDR 14,908m) is held at the sum of the FY25 allocations of the 74 countries modelled. Money freed by a cutoff, including base and FCV, goes back into the performance-based pot.
- **FCV allocations** are fixed at their FY25 values.
- **Pakistan cap:** Pakistan is capped at 6.88% of the total, and any excess is shared among other countries in proportion to their raw scores.
- **Validation:** with FY25 parameters the model reproduces published allocations to within SDR 0.06m. Pakistan is the exception at SDR 0.5m, because 6.88% is a rounded figure.

**Equivalence (tab 2).** Only the selected country's raw score changes, so two changes have the same effect when they give the same raw score. That gives a closed form, with no goal seek needed:

```
CPR change equivalent to GNI pc × f:   d = CPR × (f^(e_gni / e_cpr) − 1)
GNI pc multiplier equivalent to CPR + d: f = ((CPR + d) / CPR)^(e_cpr / e_gni)
```

The equivalence does not hold when a GNI change moves a country across the cutoff. The tool flags this case.

**Poverty correlation.** This is the Pearson correlation, across all 74 countries, between allocation per person (SDR) and the poverty headcount ratio. Countries excluded by a cutoff count as zero.

Small states are worth keeping in mind. The base allocation gives very small countries such as Tuvalu very high allocations per person, so they strongly influence the "+ base" measures.

## Data

| Data | Source | Notes |
|---|---|---|
| CPR, CPIA, PPR, population, GNI per capita, allocations | World Bank, IDA FY25 allocations table (Tables 1–2), `data/raw/FY25-Allocations-Table.xlsx`, sheet `forR` | SDR million |
| FCV allocations | [IDA FY25 Board paper, p. 21](https://documents1.worldbank.org/curated/en/099121925154535548/pdf/BOSIB-9e75e5f3-f967-4e77-804b-c17a0489b8f5.pdf#page=21) | Hard-coded in `scripts/prepare-data.R` |
| Poverty headcount | [World Bank Poverty and Inequality Platform](https://pip.worldbank.org) API, 2025, $3.00/day (2021 PPP), national, `fill_gaps=true` | All are nowcasts; some extrapolate from old surveys. CC BY 4.0 |

**Exclusions:**

- Eritrea and Zimbabwe: non-accrual, zero allocation.
- Syria: no CPR or GNI per capita.
- Myanmar: its allocation reflects an ad hoc adjustment.

**Backed-out values:** missing GNI per capita (Afghanistan, Bhutan, South Sudan, Tonga, Yemen) or CPR (Belize, Eswatini, Suriname) is backed out from the published allocation, using the common raw score / PBA ratio (1.475).

### Regenerating the data

```
Rscript scripts/prepare-data.R
```

Run it from the repo root. It requires R with `readxl`, `dplyr` and `jsonlite`, and writes `data/pba.json`. To add another poverty line (for example $4.20), add it to `POVERTY_LINES` at the top of the script. A poverty line selector then appears in the tool automatically.

## Technical choices

- **Stack:** plain HTML, CSS and JavaScript with no build step.
  - `js/model.js`: the allocation model, a port of `WB_PBA.R`.
  - `js/app.js`: the user interface.
  - `tracking.js`: analytics, per the CGD analytics tracking standard.
- **Charts:** Chart.js 4.4.1 from jsDelivr, pinned and loaded with an SRI hash.
- **Data:** a single 13 KB JSON file, loaded from the same origin. There is no live API call in the browser.
- **Embedding:** the CGD iframe resize script is included, there is no outer chrome, and the layout is responsive from 320px.
- **Fonts:** Sofia Pro through CGD's Adobe Fonts kit.

## Local development

```
python -m http.server 8765
```

Then open http://localhost:8765. A server is needed because the page fetches `data/pba.json`.

**Before committing any change to the page's files** (CSS, JS or data), run:

```
python scripts/bump-version.py
```

This stamps a new `?v=` version on the page's own files. GitHub Pages lets browsers cache files for 10 minutes. Without a new stamp, a visitor can get a new `index.html` with an old cached script, and new controls then do nothing.

## Hosting

The repo is currently under `euan-cgd` for development. For embedding on cgdev.org it needs to move to the `center-for-global-development` GitHub organisation. The cgdev.org iframe-resize listener only accepts that GitHub Pages origin, so resizing won't work from a personal `github.io` address. Analytics events are accepted from any `*.github.io` origin.

## Limitations

- **FY25 snapshot:** the tool covers FY25 only and does not model other IDA allocation features (for example, regional windows and the crisis response window).
- **Pakistan cap:** the 6.88% cap is treated as fixed.
- **Units:** all allocations are in SDR million, as in the source table.
