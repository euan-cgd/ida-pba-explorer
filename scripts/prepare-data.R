# prepare-data.R
#
# Builds data/pba.json for the IDA PBA explorer from:
#   - data/raw/FY25-Allocations-Table.xlsx (sheet "forR"), World Bank IDA FY25
#     allocations table (Table 1 and Table 2 inputs), SDR millions
#   - FCV allocations from the IDA FY25 Board paper (hard-coded below)
#   - World Bank Poverty and Inequality Platform (PIP) 2025 nowcasts
#
# Run from the repo root:  Rscript scripts/prepare-data.R
#
# Adapted from WB_PBA.R. Requires readxl, dplyr, jsonlite.

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(jsonlite)
})

# ---- Settings -----------------------------------------------------------------

# Poverty lines (2021 PPP $/day) to fetch. Add more here (e.g. 4.2) and they
# will appear as options in the tool automatically.
POVERTY_LINES <- c(3)
POVERTY_YEAR  <- 2025

# Countries excluded from the model
#   Eritrea, Zimbabwe: non-accrual, zero allocation
#   Syria: missing both CPR and GNI per capita, so neither can be backed out
#   Myanmar: allocation reflects an ad hoc adjustment, not the formula
EXCLUDE <- c("Eritrea", "Zimbabwe", "Syria", "Myanmar")

BASE_FY25 <- 15          # SDR million per country
EXP_CPR_FY25 <- 3
EXP_GNI_FY25 <- -0.125

# FCV allocations are not in the allocations table. Source:
# https://documents1.worldbank.org/curated/en/099121925154535548/pdf/BOSIB-9e75e5f3-f967-4e77-804b-c17a0489b8f5.pdf#page=21
FCV <- c(
  "Burundi" = 78.5, "Benin" = 163.2, "Chad" = 52.4, "Mozambique" = 163.2,
  "Togo" = 96, "Haiti" = 20.3, "South Sudan" = 41.9,
  "Yemen, Republic of" = 57.4, "Gambia, The" = 50.2, "Somalia" = 156.2
)

# Allocation-table names that differ from PIP's country names
ISO_OVERRIDES <- c(
  "Congo, Democratic Republic of"   = "COD",
  "Sao Tome and Principe"           = "STP",
  "Somalia"                         = "SOM",
  "Cape Verde"                      = "CPV",
  "Congo, Republic of"              = "COG",
  "Cote d'Ivoire"                   = "CIV",
  "Lao People's Democratic Republic" = "LAO",
  "Micronesia, Federated States of" = "FSM",
  "Syria"                           = "SYR",
  "Yemen, Republic of"              = "YEM"
)

# ---- Allocations ----------------------------------------------------------------

alloc <- read_excel("data/raw/FY25-Allocations-Table.xlsx", sheet = "forR", na = "na") %>%
  mutate(across(c(CPIA_ave_abc, CPIA_D, PPR, CPR, pop, gnipc, allocation), as.numeric)) %>%
  filter(!country %in% EXCLUDE) %>%
  mutate(
    FCV = coalesce(unname(FCV[country]), 0),
    alloc_pba = allocation - FCV - BASE_FY25
  )

# Back out missing GNI per capita or CPR from the published allocation.
# raw_score / alloc_pba is constant across countries (except capped Pakistan);
# take the modal rounded ratio, as in WB_PBA.R.
ratio <- with(alloc, round((CPR^EXP_CPR_FY25) * pop * (gnipc^EXP_GNI_FY25) / alloc_pba, 3))
Ratio <- as.numeric(names(sort(-table(ratio)))[1])
message("Modal raw score / PBA allocation ratio: ", Ratio)

alloc <- alloc %>%
  mutate(
    gnipc_imputed = is.na(gnipc),
    cpr_imputed   = is.na(CPR),
    gnipc = if_else(gnipc_imputed,
                    ((CPR^EXP_CPR_FY25) * pop / (Ratio * alloc_pba))^(1 / -EXP_GNI_FY25),
                    gnipc),
    CPR   = if_else(cpr_imputed,
                    ((Ratio * alloc_pba * gnipc^(-EXP_GNI_FY25)) / pop)^(1 / EXP_CPR_FY25),
                    CPR)
  )

stopifnot(!anyNA(alloc$gnipc), !anyNA(alloc$CPR))

# ---- Poverty (PIP nowcasts) -------------------------------------------------------

fetch_pip <- function(povline) {
  url <- paste0(
    "https://api.worldbank.org/pip/v1/pip?country=all&year=", POVERTY_YEAR,
    "&povline=", povline, "&fill_gaps=true&ppp_version=2021&format=csv"
  )
  read.csv(url, stringsAsFactors = FALSE, encoding = "UTF-8") %>%
    filter(reporting_level == "national") %>%
    select(country_code, country_name, headcount, estimate_type) %>%
    mutate(poverty_line = povline)
}

pip <- bind_rows(lapply(POVERTY_LINES, fetch_pip))

name_to_iso <- pip %>% distinct(country_name, country_code)
alloc <- alloc %>%
  left_join(name_to_iso, by = c("country" = "country_name")) %>%
  mutate(iso3c = coalesce(unname(ISO_OVERRIDES[country]), country_code)) %>%
  select(-country_code)

stopifnot(!anyNA(alloc$iso3c))

for (pl in POVERTY_LINES) {
  col <- paste0("pov_", pl)
  p <- pip %>% filter(poverty_line == pl) %>% select(country_code, headcount)
  alloc <- alloc %>%
    left_join(p, by = c("iso3c" = "country_code")) %>%
    rename(!!col := headcount)
  missing <- alloc$country[is.na(alloc[[col]])]
  if (length(missing)) stop("No PIP headcount at $", pl, " for: ", paste(missing, collapse = ", "))
}

types <- unique(pip$estimate_type[pip$country_code %in% alloc$iso3c])
message("PIP estimate types used: ", paste(types, collapse = ", "))

# ---- Write JSON -------------------------------------------------------------------

alloc <- alloc %>% arrange(country)

# Poverty headcounts as {"<line>": headcount}, built from the sorted rows
pov_list <- lapply(seq_len(nrow(alloc)), function(i) {
  setNames(lapply(POVERTY_LINES, function(pl) alloc[[paste0("pov_", pl)]][i]),
           as.character(POVERTY_LINES))
})

countries <- alloc %>%
  transmute(
    country, iso3 = iso3c,
    cpr = round(CPR, 6), gnipc = round(gnipc, 2), pop = pop,
    fcv = FCV, allocation = round(allocation, 4),
    gnipc_imputed, cpr_imputed
  )
countries$pov <- pov_list

out <- list(
  meta = list(
    generated = format(Sys.Date()),
    currency = "SDR million",
    total_allocation = sum(alloc$allocation),
    fy25 = list(exp_cpr = EXP_CPR_FY25, exp_gni = EXP_GNI_FY25, base = BASE_FY25, pak_cap = 0.0688),
    poverty_lines = I(POVERTY_LINES),
    poverty_year = POVERTY_YEAR,
    poverty_source = "World Bank Poverty and Inequality Platform (PIP), 2021 PPP, nowcasts",
    excluded = I(EXCLUDE)
  ),
  countries = countries
)

write_json(out, "data/pba.json", auto_unbox = TRUE, digits = NA)
message("Wrote data/pba.json: ", nrow(countries), " countries, total SDR ",
        round(sum(alloc$allocation), 1), "m")
