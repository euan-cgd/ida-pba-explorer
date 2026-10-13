# Event Tracking: IDA Allocation Formula Explorer

`interactive_name`: `ida-pba-explorer`

Tracking implemented per the CGD Interactive Analytics Tracking Standard (`analytics-tracking-standard.md` in the CGD interactive toolkit).

`interactive_view` fires once, after the data has loaded.

## Tracked Events

| `action_type` | `action_label` | `action_value` | Notes |
|---|---|---|---|
| `navigate` | `section_tab` | `change_formula`, `change_country` | Tab switch |
| `filter` | `gni_exponent_slider` | slider value (−1 to −0.125, step 0.025) | Fires on `change` |
| `filter` | `cpr_exponent_slider` | slider value (1 to 4, step 0.1) | Fires on `change` |
| `filter` | `base_allocation_slider` | slider value (0 to 50) | Fires on `change` |
| `filter` | `gni_cutoff_slider` | slider value (1,000 to 12,000, step 250) | Fires on `change` |
| `filter` | `gni_cutoff_toggle` | `on`, `off` | |
| `filter` | `poverty_line_select` | poverty line, e.g. `3` | Only shown if more than one line is in the data |
| `preset` | `reset_fy25` | | Resets formula to FY25 |
| `view_control` | `scatter_x_axis` | `gnipc`, `cpr`, `pov` | |
| `view_control` | `change_metric` | `pct`, `abs` | |
| `view_control` | `table_sort` | column key (`country`, `gnipc`, `cpr`, `pov`, `base`, `now`, `abs`, `pct`) | |
| `download` | `results_csv` | | CSV of the country table |
| `filter` | `country_select` | country name (74 values) | Tab 2 |
| `filter` | `change_variable` | `gni`, `cpr` | Tab 2 |
| `filter` | `formula_basis` | `fy25`, `mine` | Tab 2 |
| `filter` | `gni_multiplier_slider` | multiplier, 2 d.p. (0.25 to 10) | Tab 2, fires on `change` |
| `filter` | `cpr_change_slider` | CPR change, 2 d.p. (−1.5 to 1.5) | Tab 2, fires on `change` |

## Not Tracked

- **Chart hover and tooltips:** high volume, low signal.
- **Slider drag (`input` events):** only the final `change` value is sent.
