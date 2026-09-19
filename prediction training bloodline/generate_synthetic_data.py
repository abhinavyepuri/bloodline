#!/usr/bin/env python3
"""
SmartBlood — Synthetic Operational Data Generator
==================================================

Generates a day-by-day, per-(blood bank × blood group × component) dataset
of demand, donations, expiry and inventory, suitable for training and
validating the SmartBlood demand-forecasting / shortage-risk / expiry-risk
models before real hospital data is available.

WHY THIS EXISTS
----------------
Public datasets that map cleanly onto SmartBlood's schema (date, bank,
group, component, opening/closing inventory, demand, donations, expiry)
could not be confirmed as freely downloadable at the time this was written
(the Tema Ghana CSV/code repo referenced in some blood-forecasting papers,
and a rumoured 30k-row "Blood Bank Supply Management" Hugging Face set,
were not locatable). Rather than block on that, this generator produces
data statistically anchored to numbers that ARE published and verifiable:

  - ABO/Rh prevalence in the Indian population (used to split demand and
    donations across the 8 blood groups)
  - Daily blood-demand coefficient of variation (CV) by ABO group, and
    monthly seasonality (dip in November, peaks around May/July/December),
    both taken from a peer-reviewed 3-year Indian blood-donation study
    (Shruthi et al., Discover Applied Sciences, 2026)
  - A near-flat weekday effect on donations (same study: no strong
    weekend/weekday split was found)

WHAT IS NOT REAL
-----------------
  - The facility list (names/districts/states) below is a REPRESENTATIVE
    placeholder, not scraped or pulled from e-RaktKosh or data.gov.in. Swap
    FACILITIES for a real pull from data.gov.in's blood-bank directory
    (free API key) if you want authentic facility metadata for the demo.
  - Absolute demand *volumes* per facility are illustrative, not measured.
    Only the *shape* (seasonality, weekday flatness, per-group CV, ABO
    mix) is calibrated to published statistics.
  - Inter-facility transfers are a simple random placeholder, not a
    network-flow simulation.

Treat this as Layer 2 (synthetic operational data) laid over Layer 1
(real demand-shape statistics), per the two-layer data strategy discussed
for SmartBlood.

USAGE
-----
    python3 generate_synthetic_data.py \
        --start-date 2023-01-01 --end-date 2024-12-31 \
        --seed 42 --out-dir /mnt/user-data/outputs

Outputs:
    blood_banks_master.csv       — facility dimension table
    smartblood_synthetic_data.csv — the daily fact table (main dataset)
"""

import argparse
import csv
from collections import deque
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Calibration constants
# ---------------------------------------------------------------------------

# ABO/Rh prevalence in the Indian population (approximate, widely-cited
# figures used across multiple Indian blood-bank studies). Used to split
# both demand and donations across the 8 blood groups.
BLOOD_GROUP_PREVALENCE = {
    "O+": 0.3712, "B+": 0.2288, "A+": 0.2086, "AB+": 0.0703,
    "O-": 0.0379, "B-": 0.0233, "A-": 0.0213, "AB-": 0.0083,
}

# Daily demand coefficient of variation by ABO group (A/B ~0.8, AB ~1.05,
# O ~0.73 — AB is the noisiest because volumes are lowest). Rh factor
# doesn't change the CV, only the volume via prevalence above.
GROUP_CV = {
    "A+": 0.80, "A-": 0.80,
    "B+": 0.79, "B-": 0.79,
    "AB+": 1.05, "AB-": 1.05,
    "O+": 0.73, "O-": 0.73,
}

# Blood components modelled, their share of total demand, shelf life, and
# how many usable component-units one whole-blood donation yields.
COMPONENT_PROFILE = {
    "PRBC":      {"demand_share": 0.55, "shelf_life_days": 42,  "donation_yield": 1.0},
    "Platelets": {"demand_share": 0.25, "shelf_life_days": 5,   "donation_yield": 0.9},
    "FFP":       {"demand_share": 0.20, "shelf_life_days": 365, "donation_yield": 1.0},
}

# Monthly seasonality multiplier vs. annual average — dip in November,
# highs around May / July / December (per the calibration source).
MONTH_SEASONALITY = {
    1: 1.00, 2: 1.00, 3: 1.02, 4: 1.03, 5: 1.12, 6: 1.05,
    7: 1.12, 8: 1.05, 9: 1.00, 10: 0.97, 11: 0.85, 12: 1.10,
}

# Weekday multiplier, Mon=0 .. Sun=6. Kept close to flat (no strong
# weekday effect found in the source study), with only a small Sunday dip
# reflecting fewer donation camps/elective procedures.
WEEKDAY_FACTOR = {0: 1.00, 1: 1.00, 2: 1.00, 3: 1.00, 4: 1.02, 5: 0.98, 6: 0.95}

# TTI (transfusion-transmitted infection) reactive-donation discard rate —
# units lost immediately on screening, before ever entering usable stock.
TTI_DISCARD_RATE = 0.010

# Long-run donations are targeted slightly above demand so inventory
# doesn't structurally collapse or explode; this is the safety margin.
DONATION_SAFETY_MARGIN = 0.08
DONATION_CV_MULTIPLIER = 1.15  # donations are a bit noisier than demand

# Facility size tiers -> baseline total daily demand (all groups/components
# combined) before splitting by group prevalence and component share.
TIER_BASE_DEMAND = {"large": 100.0, "medium": 55.0, "small": 24.0}

# Representative facility list — NOT scraped from e-RaktKosh / data.gov.in.
# (name, district, state, tier)
FACILITIES = [
    ("Vijayawada Govt. General Hospital Blood Bank", "Krishna", "Andhra Pradesh", "large"),
    ("Guntur Govt. General Hospital Blood Bank", "Guntur", "Andhra Pradesh", "medium"),
    ("Visakhapatnam King George Hospital Blood Bank", "Visakhapatnam", "Andhra Pradesh", "large"),
    ("Hyderabad NIMS Blood Bank", "Hyderabad", "Telangana", "large"),
    ("Chennai Govt. General Hospital Blood Bank", "Chennai", "Tamil Nadu", "large"),
    ("Bengaluru Victoria Hospital Blood Bank", "Bengaluru Urban", "Karnataka", "large"),
    ("Mumbai KEM Hospital Blood Bank", "Mumbai", "Maharashtra", "large"),
    ("Pune Sassoon Hospital Blood Bank", "Pune", "Maharashtra", "medium"),
    ("Delhi AIIMS Blood Bank", "New Delhi", "Delhi", "large"),
    ("Kolkata Medical College Blood Bank", "Kolkata", "West Bengal", "large"),
    ("Nagpur Govt. Medical College Blood Bank", "Nagpur", "Maharashtra", "medium"),
    ("Kochi General Hospital Blood Bank", "Ernakulam", "Kerala", "small"),
]


# ---------------------------------------------------------------------------
# Core simulation
# ---------------------------------------------------------------------------

@dataclass
class Batch:
    units: int
    expiry_date: date


@dataclass
class SeriesState:
    """Running FEFO inventory queue for one (facility, group, component)."""
    batches: deque = field(default_factory=deque)

    def total_units(self) -> int:
        return sum(b.units for b in self.batches)

    def expire_up_to(self, today: date) -> int:
        """Remove and count units whose batch has expired as of today."""
        expired = 0
        remaining = deque()
        for b in self.batches:
            if b.expiry_date < today:
                expired += b.units
            else:
                remaining.append(b)
        self.batches = remaining
        return expired

    def fulfil_fefo(self, requested: int) -> int:
        """Consume oldest-expiry-first batches to satisfy `requested` units.
        Returns units actually fulfilled."""
        fulfilled = 0
        # batches are appended in arrival order but we always want the
        # nearest-expiry batch first, so sort by expiry each call (series
        # are small, this is cheap enough at this data scale).
        ordered = deque(sorted(self.batches, key=lambda b: b.expiry_date))
        new_batches = deque()
        remaining_request = requested
        for b in ordered:
            if remaining_request <= 0:
                new_batches.append(b)
                continue
            take = min(b.units, remaining_request)
            fulfilled += take
            remaining_request -= take
            leftover = b.units - take
            if leftover > 0:
                new_batches.append(Batch(leftover, b.expiry_date))
        self.batches = new_batches
        return fulfilled

    def add_batch(self, units: int, expiry_date: date):
        if units > 0:
            self.batches.append(Batch(units, expiry_date))


def gamma_sample(rng: np.random.Generator, mean: float, cv: float) -> float:
    """Sample a non-negative value from a Gamma distribution with the given
    mean and coefficient of variation (CV = std/mean)."""
    if mean <= 0:
        return 0.0
    shape = 1.0 / (cv ** 2)
    scale = mean / shape
    return float(rng.gamma(shape, scale))


def build_series_means(facilities):
    """Precompute base daily demand & donation means for every
    (facility, group, component) combination."""
    means = {}
    for fac in facilities:
        tier_demand = TIER_BASE_DEMAND[fac["tier"]]
        for group, group_share in BLOOD_GROUP_PREVALENCE.items():
            for comp, profile in COMPONENT_PROFILE.items():
                demand_mean = tier_demand * group_share * profile["demand_share"]
                donation_mean = (
                    demand_mean
                    * (1 + DONATION_SAFETY_MARGIN)
                    / profile["donation_yield"]
                )
                means[(fac["blood_bank_id"], group, comp)] = {
                    "demand_mean": demand_mean,
                    "donation_mean": donation_mean,
                }
    return means


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def generate(start_date: date, end_date: date, seed: int, out_dir: str):
    rng = np.random.default_rng(seed)

    facilities = [
        {
            "blood_bank_id": f"BB{idx+1:03d}",
            "name": name,
            "district": district,
            "state": state,
            "tier": tier,
        }
        for idx, (name, district, state, tier) in enumerate(FACILITIES)
    ]

    means = build_series_means(facilities)

    # Seed initial inventory: ~5 days of average demand, spread across a
    # few batches with staggered expiry so day 1 isn't artificially empty.
    states = {}
    for key, m in means.items():
        fac_id, group, comp = key
        shelf_life = COMPONENT_PROFILE[comp]["shelf_life_days"]
        st = SeriesState()
        seed_units_total = max(0, round(m["demand_mean"] * 5))
        n_batches = 3
        for i in range(n_batches):
            units = seed_units_total // n_batches
            expiry = start_date + timedelta(days=max(1, shelf_life // (i + 1)))
            st.add_batch(units, expiry)
        states[key] = st

    rows = []
    total_days = (end_date - start_date).days + 1

    for day_idx, today in enumerate(daterange(start_date, end_date)):
        month_factor = MONTH_SEASONALITY[today.month]
        weekday_factor = WEEKDAY_FACTOR[today.weekday()]

        for key, m in means.items():
            fac_id, group, comp = key
            st = states[key]
            profile = COMPONENT_PROFILE[comp]
            cv = GROUP_CV[group]

            opening_inventory = st.total_units()

            # 1. Expire anything whose shelf life has run out overnight.
            units_expired = st.expire_up_to(today)

            # 2. Donations arrive (net of TTI-reactive discards).
            donation_factor = month_factor * weekday_factor
            raw_donations = gamma_sample(
                rng, m["donation_mean"] * donation_factor, cv * DONATION_CV_MULTIPLIER
            )
            raw_donations = int(round(raw_donations))
            units_discarded_tti = int(round(raw_donations * TTI_DISCARD_RATE))
            donations_collected = max(0, raw_donations - units_discarded_tti)
            expiry_date = today + timedelta(days=profile["shelf_life_days"])
            st.add_batch(donations_collected, expiry_date)

            # 3. Small, simplistic inter-facility transfers (placeholder —
            #    not a real network-flow model).
            transfer_roll = rng.random()
            transfers_in = 0
            transfers_out = 0
            if transfer_roll < 0.03:
                transfers_in = int(rng.integers(1, 6))
                st.add_batch(transfers_in, today + timedelta(days=profile["shelf_life_days"] // 2))
            elif transfer_roll > 0.97 and st.total_units() > 0:
                transfers_out = min(st.total_units(), int(rng.integers(1, 6)))
                st.fulfil_fefo(transfers_out)  # reuse FEFO consumption for outgoing transfer

            # 4. Demand arrives and is fulfilled FEFO.
            demand_factor = month_factor * weekday_factor
            units_requested = int(round(gamma_sample(rng, m["demand_mean"] * demand_factor, cv)))
            units_fulfilled = st.fulfil_fefo(units_requested)

            closing_inventory = st.total_units()
            units_wasted = units_expired + units_discarded_tti

            rows.append(
                {
                    "date": today.isoformat(),
                    "blood_bank_id": fac_id,
                    "blood_group": group,
                    "component_type": comp,
                    "opening_inventory": opening_inventory,
                    "donations_collected": donations_collected,
                    "units_discarded_tti": units_discarded_tti,
                    "transfers_in": transfers_in,
                    "transfers_out": transfers_out,
                    "units_requested": units_requested,
                    "units_fulfilled": units_fulfilled,
                    "units_expired": units_expired,
                    "units_wasted": units_wasted,
                    "closing_inventory": closing_inventory,
                }
            )

        if day_idx % 90 == 0 or day_idx == total_days - 1:
            print(f"  ...simulated {day_idx + 1}/{total_days} days")

    df = pd.DataFrame(rows)

    fac_df = pd.DataFrame(facilities)[
        ["blood_bank_id", "name", "district", "state", "tier"]
    ]

    fac_path = f"{out_dir}/blood_banks_master.csv"
    data_path = f"{out_dir}/smartblood_synthetic_data.csv"
    fac_df.to_csv(fac_path, index=False)
    df.to_csv(data_path, index=False)

    print(f"\nWrote {len(fac_df)} facilities -> {fac_path}")
    print(f"Wrote {len(df):,} rows ({df['blood_bank_id'].nunique()} banks x "
          f"{df['blood_group'].nunique()} groups x {df['component_type'].nunique()} "
          f"components x {total_days} days) -> {data_path}")

    return fac_df, df


def main():
    parser = argparse.ArgumentParser(description="Generate SmartBlood synthetic data.")
    parser.add_argument("--start-date", default="2023-01-01")
    parser.add_argument("--end-date", default="2024-12-31")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out-dir", default=".")
    args = parser.parse_args()

    start = date.fromisoformat(args.start_date)
    end = date.fromisoformat(args.end_date)
    generate(start, end, args.seed, args.out_dir)


if __name__ == "__main__":
    main()
