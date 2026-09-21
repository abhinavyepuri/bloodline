# SmartBlood — ML Integration Handoff Specification

## 1. Purpose of this document

This document is the handoff specification for the coding AI agent responsible for integrating the finalized machine-learning and decision-support work from the Colab environment into the existing SmartBlood backend.

The backend agent should treat the ML work described here as **already implemented and validated**. The integration task is to understand, preserve, and expose the existing ML behavior through the project's existing backend architecture.

The agent should **not redesign the ML methodology unnecessarily**, retrain models, or invent a parallel workflow. It should inspect the existing repository and adapt the ML layer to the services, database models, API conventions, authentication, configuration, and frontend contracts that already exist.

The existing real-world workflow should remain intact. SmartBlood is intended to add a **prediction, inventory-risk, monitoring, and decision-support layer** around existing blood-bank/hospital operations rather than create a new clinical pathway.

---

# 2. Product concept

SmartBlood is a blood-network decision-support system focused on:

- next-day blood/component demand forecasting
- demand-spike risk detection
- inventory shortage risk
- wastage/expiry risk
- inventory coverage analysis
- network-level monitoring and alerts
- transfer/replenishment recommendations
- what-if simulation
- future integration with real blood-bank data

The central flow is:

```text
Historical / Current Blood-Bank Data
                |
                v
       Feature Engineering
                |
       +--------+--------+---------+
       |                 |         |
       v                 v         v
 Demand Forecast    Spike Risk   Wastage Risk
       |                 |         |
       +-----------------+---------+
                         |
                         v
                Inventory Risk
                         |
                         v
                 Decision Engine
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
       Alerts        Transfers       Dashboard
```

The ML models are therefore components of a larger operational decision engine.

---

# 3. Important architectural principles

## 3.1 Do not put ML logic in the frontend

The frontend should consume backend outputs.

Preferred architecture:

```text
Frontend
   |
   v
Existing Backend / REST API
   |
   +-----------------------------+
   |                             |
   v                             v
Prediction / Risk Services    Database
   |
   v
Frozen ML Artifacts
```

The frontend must not load `.pkl` files or reproduce feature engineering.

## 3.2 Do not copy the Colab notebook wholesale into the backend

The Colab notebook was an experimentation and validation environment.

The backend should extract the finalized logic into maintainable services such as:

```text
ML model loading
Feature construction
Demand prediction
Spike-risk prediction
Inventory-risk prediction
Wastage-risk prediction
Decision/risk engine
Transfer recommendation engine
Alert generation
```

The exact module names and locations should follow the existing repository architecture.

## 3.3 Preserve existing backend conventions

Before modifying code, inspect:

- existing backend framework
- existing service layer
- database schema/models
- authentication and authorization
- existing routes
- validation schemas
- configuration/environment handling
- logging
- error handling
- frontend API consumption
- existing inventory/request/transfer concepts

Do not create duplicate services if equivalent services already exist.

## 3.4 ML is decision support, not autonomous clinical authorization

The system may recommend monitoring, replenishment, or network transfers.

It must not claim to replace:

- blood-bank staff
- clinical judgment
- compatibility/crossmatching procedures
- regulatory procedures
- existing hospital/blood-bank authorization workflows

---

# 4. Dataset used in Colab

The main ML dataset was `SMARTBLOOD`.

Shape:

```text
210,528 rows × 14 columns
```

Date range:

```text
2023-01-01 → 2024-12-31
```

Number of blood banks:

```text
12
```

Blood groups:

```text
A+
A-
AB+
AB-
B+
B-
O+
O-
```

Components:

```text
FFP
PRBC
Platelets
```

The dataset forms a complete grid:

```text
12 blood banks
× 8 blood groups
× 3 components
× 731 dates
= 210,528 rows
```

Every bank has exactly 17,544 rows.

Every component has exactly 70,176 rows.

Every blood group has exactly 26,316 rows.

There are 288 independent time series:

```text
12 banks × 8 groups × 3 components
```

Each series contains exactly 731 daily observations.

There were no duplicate records and no missing dates in the complete grid.

---

# 5. SmartBlood columns

The core dataset contains:

```text
date
blood_bank_id
blood_group
component_type
opening_inventory
donations_collected
units_discarded_tti
transfers_in
transfers_out
units_requested
units_fulfilled
units_expired
units_wasted
closing_inventory
```

Important interpretation:

- `units_requested` = demand/request volume
- `units_fulfilled` = amount actually fulfilled
- `closing_inventory` = end-of-day inventory
- `donations_collected` = incoming stock from donations
- `transfers_in` = stock received from another bank
- `transfers_out` = stock sent to another bank
- `units_expired` = expired stock
- `units_wasted` = wasted/discarded stock

---

# 6. Other source datasets

The Colab environment also loaded:

```text
DIRECTORY
CAMPS
LICENSED
COLLECTED
ISSUED
DISCARDED
RATIO
SMARTBLOOD
```

Directory data contained:

```text
2,823 × 27
```

and included blood-bank metadata such as:

```text
Blood Bank Name
State
District
City
Address
Latitude
Longitude
```

Latitude and longitude were complete.

The other datasets were used primarily for exploration/context rather than as direct predictors in the finalized models.

---

# 7. Data cleaning performed

The Colab setup included:

```python
def clean_columns(df):
    df = df.copy()
    df.columns = (
        df.columns.astype(str)
        .str.strip()
        .str.replace(r"\s+", " ", regex=True)
    )
    return df
```

Numeric cleaning:

```python
def num(x):
    if pd.isna(x):
        return np.nan
    x = str(x).replace(",", "").strip()
    x = re.sub(r"[^\d.\-]", "", x)
    return pd.to_numeric(x, errors="coerce")
```

State normalization was also performed to handle inconsistent state naming.

The SmartBlood date column was converted using:

```python
smart["date"] = pd.to_datetime(
    smart["date"],
    errors="coerce"
)
```

---

# 8. Data-quality observations

Inventory reconciliation was checked.

There were:

```text
14,484 inventory reconciliation mismatches
```

Most were exact or small differences.

Maximum mismatch:

```text
112 units
```

These rows were not deleted because the targets remained usable and the differences were treated as accounting/synthetic-data inconsistencies.

All inventory-flow input columns were nonnegative.

Demand was highly skewed and zero-heavy:

```text
units_requested mean:   3.344
std:                     6.207
median:                  1
75th percentile:         4
maximum:               145
```

There were:

```text
4,885 rows
```

where request exceeded fulfillment, approximately:

```text
2.32%
```

Mean fulfillment rate was approximately:

```text
0.9828
```

---

# 9. Common time-series grouping

All temporal features were calculated independently for each:

```text
blood_bank_id
blood_group
component_type
```

Conceptually:

```python
group_cols = [
    "blood_bank_id",
    "blood_group",
    "component_type"
]
```

This is important.

A lag or rolling statistic must never mix:

- different blood banks
- different blood groups
- different components

---

# 10. Model 1 — Next-Day Demand Forecast

## Objective

Predict the next day's requested units for each:

```text
blood bank × blood group × component
```

Target:

```text
target_demand_next_day
```

defined as:

```python
smart["target_demand_next_day"] = (
    g["units_requested"].shift(-1)
)
```

The final 288 rows with no next-day target were naturally excluded.

---

# 11. Model 1 feature engineering

Calendar features were created for the **target day**, not the current day.

```text
target_day_of_week
target_month
target_day_of_year
target_week_of_year
target_is_weekend
```

The target date was:

```python
smart["target_date"] = (
    smart["date"] + pd.Timedelta(days=1)
)
```

Demand history:

```text
demand_lag_1
demand_lag_7
demand_lag_14
demand_lag_28

demand_avg_3
demand_avg_7
demand_avg_14
demand_avg_28

demand_max_7
demand_max_14
demand_max_28

demand_std_7

spike_count_7
spike_count_14
spike_count_28

demand_trend
```

`demand_trend`:

```text
demand_avg_3 - demand_avg_14
```

Operational context:

```text
fulfillment_avg_7
inventory_avg_7
inventory_lag_1
inventory_lag_7
donations_avg_7
transfers_in_avg_7
transfers_out_avg_7
wastage_avg_7
expiry_avg_7
```

Rolling features use shifted data:

```text
shift(1)
```

before rolling.

This is critical to avoid using the current/target day's value and causing leakage.

---

# 12. Model 1 training split

Training:

```text
date <= 2024-09-30
```

Test:

```text
date >= 2024-10-01
```

Training rows:

```text
175,968
```

Test rows:

```text
26,208
```

The model therefore uses a chronological holdout rather than a random split.

---

# 13. Model 1 preprocessing

Categorical columns:

```text
blood_bank_id
blood_group
component_type
```

These were one-hot encoded using:

```python
OneHotEncoder(handle_unknown="ignore")
```

Numeric columns were passed through.

The final encoded dimensions were:

```text
175,968 × 45
26,208 × 45
```

The preprocessing object must be saved and loaded together with the model.

---

# 14. Model 1 algorithm

The finalized model is:

```python
HistGradientBoostingRegressor(
    max_iter=300,
    learning_rate=0.08,
    max_leaf_nodes=31,
    l2_regularization=1.0,
    random_state=42
)
```

Predictions are clipped to nonnegative values:

```python
predictions = np.maximum(predictions, 0)
```

---

# 15. Model 1 validation

Baseline:

```text
MAE  = 2.0991
RMSE = 4.3467
```

Final ML model:

```text
MAE  = 2.0235
RMSE = 4.1174
```

Improvement:

```text
MAE improvement:  3.60%
RMSE improvement: 5.28%
```

ML predictions were better than baseline on:

```text
46.5163% of observations
```

High-demand test rows:

```text
2,401
```

High-demand performance:

```text
MAE  = 8.1506
RMSE = 10.9616
```

Extreme spikes remain difficult.

Examples included actual demand around:

```text
93 → predicted ~11.6
86 → predicted ~19.0
77 → predicted ~20.3
```

Therefore the backend must not represent the demand forecast as guaranteed.

The model should be presented as a forecast used with risk detection and inventory logic.

---

# 16. Model 1 — Demand Spike Risk

A separate classifier was created because the regression model naturally smooths extreme demand spikes.

Target:

```text
target_spike = 1
```

when:

```text
target_demand_next_day >= 10
```

Otherwise:

```text
0
```

Full target distribution:

```text
Normal: 189,839 (90.17%)
Spike:   20,689 (9.83%)
```

The same general feature set as the demand model was used.

---

# 17. Spike model

Algorithm:

```python
HistGradientBoostingClassifier(
    max_iter=300,
    learning_rate=0.08,
    max_leaf_nodes=31,
    l2_regularization=1.0,
    random_state=42
)
```

Encoded dimensions:

```text
175,968 × 53
26,496 × 53
```

The classifier produces:

```text
spike-risk score
```

using:

```python
predict_proba(...)[:, 1]
```

Important:

This score is **not a calibrated probability**.

Call it:

```text
spike risk score
```

rather than claiming it is a precise probability.

---

# 18. Spike model validation

At threshold 0.50:

```text
Class 0 precision: 0.9385
Class 0 recall:    0.9785
Class 0 F1:        0.9581

Class 1 precision: 0.6225
Class 1 recall:    0.3565
Class 1 F1:        0.4534

Accuracy:          0.9221
ROC-AUC:           0.93841
```

A threshold search showed the best tested F1 around:

```text
threshold = 0.30
```

with:

```text
precision = 0.5024
recall    = 0.6935
F1        = 0.5827
```

For operational warning behavior, the current working threshold is:

```text
SPIKE_THRESHOLD = 0.30
```

This is configurable.

---

# 19. Model 2 — Inventory Shortage Risk

## Objective

Predict whether current closing inventory will be insufficient to cover next-day demand.

Conceptually:

```text
closing inventory < next-day demand
```

The next-day demand value is used to construct the target only.

It must **not** be used as a feature.

`units_fulfilled` was excluded from the feature set for this model.

---

# 20. Inventory coverage

Coverage was calculated as:

```text
closing_inventory / next_day_demand
```

with zero next-day demand excluded from the denominator.

Observed:

```text
mean coverage:   31.99
median coverage: 15
maximum coverage: 1168
```

Coverage below 1:

```text
9,356 rows
4.4441%
```

Coverage below 2:

```text
16,645 rows
7.9063%
```

The actual shortage target among rows with next-day demand > 0 was:

```text
No shortage: 126,954
Shortage:      9,356
```

---

# 21. Inventory model features

Categorical:

```text
blood_bank_id
blood_group
component_type
```

Calendar:

```text
target_day_of_week
target_month
target_day_of_year
target_week_of_year
target_is_weekend
```

Inventory:

```text
inventory_lag_1
inventory_lag_7
inventory_avg_7
```

Demand:

```text
demand_lag_1
demand_lag_7
demand_lag_14

demand_avg_3
demand_avg_7
demand_avg_14
demand_avg_28

demand_max_7
demand_max_14
demand_max_28

demand_std_7

spike_count_7
spike_count_14
spike_count_28

demand_trend
```

Operations:

```text
fulfillment_avg_7
donations_avg_7
transfers_in_avg_7
transfers_out_avg_7
wastage_avg_7
expiry_avg_7
```

---

# 22. Inventory model training

The model used:

```python
HistGradientBoostingClassifier(
    max_iter=300,
    learning_rate=0.08,
    max_leaf_nodes=31,
    l2_regularization=1.0,
    random_state=42
)
```

Class imbalance was handled using sample weights.

Training counts:

```text
Normal: 168,036
Shortage: 7,932
```

Test counts:

```text
Normal: 25,334
Shortage: 874
```

Encoded dimensions:

```text
175,968 × 52
26,208 × 52
```

---

# 23. Inventory model validation

At threshold 0.50:

```text
Class 0 precision: 0.9963
Class 0 recall:    0.8947
Class 0 F1:        0.9428

Class 1 precision: 0.2283
Class 1 recall:    0.9027
Class 1 F1:        0.3644

Accuracy:          0.8950
ROC-AUC:           0.96057
PR-AUC:            0.46679
```

Confusion matrix:

```text
[[22667, 2667],
 [   85,  789]]
```

A simple baseline:

```text
closing_inventory < demand_avg_7
```

had:

```text
precision: 0.4414
recall:    0.8238
F1:        0.5749
accuracy:  0.9594
```

Therefore:

**Do not make the ML inventory classifier the sole shortage decision rule.**

The operational system should combine deterministic inventory logic with the ML risk score.

The model is best treated as a supporting risk signal.

---

# 24. Model 3 — Wastage / Expiry Risk

## Objective

Predict whether wastage or expiry will occur on the next day.

Targets:

```python
next_day_wastage = units_wasted.shift(-1)
next_day_expiry = units_expired.shift(-1)
```

Risk target:

```text
1 if next_day_wastage > 0 OR next_day_expiry > 0
0 otherwise
```

Full target distribution:

```text
Normal: 196,045 (93.1206%)
Risk:    14,483 (6.8794%)
```

---

# 25. Wastage statistics

Observed:

```text
closing_inventory mean: 79.36
closing_inventory median: 23
closing_inventory maximum: 1315

units_requested mean: 3.344
units_requested median: 1
units_requested maximum: 145

units_expired mean: 0.298
units_expired maximum: 112

units_wasted mean: 0.302
units_wasted maximum: 112
```

Totals:

```text
expired units: 62,771
wasted units:  63,493
```

Rows with expiry:

```text
13,802
```

Rows with wastage:

```text
14,484
```

---

# 26. Wastage model features

Categorical:

```text
blood_bank_id
blood_group
component_type
```

Calendar:

```text
target_day_of_week
target_month
target_day_of_year
target_week_of_year
target_is_weekend
```

Inventory:

```text
inventory_lag_1
inventory_lag_7
inventory_avg_7
```

Demand:

```text
demand_lag_1
demand_lag_7
demand_lag_14

demand_avg_3
demand_avg_7
demand_avg_14
demand_avg_28

demand_max_7
demand_max_14
demand_max_28

demand_std_7

spike_count_7
spike_count_14
spike_count_28

demand_trend
```

Operations:

```text
fulfillment_avg_7
donations_avg_7
transfers_in_avg_7
transfers_out_avg_7
```

---

# 27. Wastage model training

Algorithm:

```python
HistGradientBoostingClassifier(
    max_iter=300,
    learning_rate=0.08,
    max_leaf_nodes=31,
    l2_regularization=1.0,
    random_state=42
)
```

Class weighting was implemented with sample weights.

Training:

```text
Normal: 164,039
Risk:    11,929
```

Test:

```text
Normal: 24,411
Risk:    2,085
```

Encoded dimensions:

```text
175,968 × 50
26,496 × 50
```

---

# 28. Wastage model validation

At threshold 0.50:

```text
Class 0 precision: ~0.99
Class 0 recall:    ~0.82
Class 0 F1:        ~0.90

Class 1 precision: ~0.29
Class 1 recall:    ~0.87
Class 1 F1:        ~0.44

Accuracy:          ~0.82
ROC-AUC:           0.91859
PR-AUC:            0.47464
```

A baseline using roughly:

```text
2 × demand
```

performed poorly:

```text
precision: 0.08885
recall:    0.9947
F1:        0.1631
```

Threshold testing found the best tested F1 at:

```text
0.75
```

with:

```text
precision: 0.3953
recall:    0.6715
F1:        0.4976
```

Current operational threshold:

```text
WASTAGE_THRESHOLD = 0.75
```

Risk levels:

```text
score >= 0.75 → High
score >= 0.50 → Medium
otherwise     → Low
```

Again, these are risk scores, not calibrated probabilities.

---

# 29. Saved model artifacts

The finalized models and preprocessors were saved as:

```text
outputs/
├── demand_forecast_model.pkl
├── demand_forecast_preprocessor.pkl
├── spike_risk_model.pkl
├── spike_risk_preprocessor.pkl
├── inventory_risk_model.pkl
├── inventory_risk_preprocessor.pkl
├── wastage_risk_model.pkl
└── wastage_risk_preprocessor.pkl
```

These files are the primary artifacts the backend needs.

Model + corresponding preprocessor must always be treated as a pair.

Do not use the model with a newly fitted encoder.

Use the saved preprocessor:

```python
preprocessor.transform(...)
```

not:

```python
preprocessor.fit_transform(...)
```

for live/inference data.

---

# 30. Feature-order requirement

The backend must reproduce the exact feature names and semantic order used during training.

Demand model feature list:

```text
blood_bank_id
blood_group
component_type
target_day_of_week
target_month
target_day_of_year
target_week_of_year
target_is_weekend
demand_lag_1
demand_lag_7
demand_lag_14
demand_lag_28
demand_avg_3
demand_avg_7
demand_avg_14
demand_avg_28
demand_max_7
demand_max_14
demand_max_28
demand_std_7
spike_count_7
spike_count_14
spike_count_28
demand_trend
fulfillment_avg_7
inventory_avg_7
inventory_lag_1
inventory_lag_7
donations_avg_7
transfers_in_avg_7
transfers_out_avg_7
wastage_avg_7
expiry_avg_7
```

Spike model uses the same feature list.

Inventory model:

```text
blood_bank_id
blood_group
component_type
target_day_of_week
target_month
target_day_of_year
target_week_of_year
target_is_weekend
inventory_lag_1
inventory_lag_7
inventory_avg_7
demand_lag_1
demand_lag_7
demand_lag_14
demand_avg_3
demand_avg_7
demand_avg_14
demand_avg_28
demand_max_7
demand_max_14
demand_max_28
demand_std_7
spike_count_7
spike_count_14
spike_count_28
demand_trend
fulfillment_avg_7
donations_avg_7
transfers_in_avg_7
transfers_out_avg_7
wastage_avg_7
expiry_avg_7
```

Wastage model:

```text
blood_bank_id
blood_group
component_type
target_day_of_week
target_month
target_day_of_year
target_week_of_year
target_is_weekend
inventory_lag_1
inventory_lag_7
inventory_avg_7
demand_lag_1
demand_lag_7
demand_lag_14
demand_avg_3
demand_avg_7
demand_avg_14
demand_avg_28
demand_max_7
demand_max_14
demand_max_28
demand_std_7
spike_count_7
spike_count_14
spike_count_28
demand_trend
fulfillment_avg_7
donations_avg_7
transfers_in_avg_7
transfers_out_avg_7
```

---

# 31. Decision engine

The ML models were combined into an operational decision layer.

Inputs:

```text
closing_inventory
predicted_demand
predicted_coverage
spike_risk
inventory_risk
wastage_risk
```

Predicted coverage:

```text
closing_inventory / predicted_demand
```

when predicted demand is nonzero.

Operational risk levels used in the Colab:

```text
Critical
High
Medium
Low
```

The logic was:

```text
IF predicted_demand > 0 AND closing_inventory < predicted_demand
    Critical

ELSE IF predicted_coverage < 2
    High

ELSE IF spike_risk >= 0.30
    High

ELSE IF predicted_coverage < 5
    Medium

ELSE IF inventory_risk >= 0.50
    Medium

ELSE
    Low
```

Resulting counts on the historical test set:

```text
Low:       17,536
High:       3,724
Medium:     2,594
Critical:   2,354
```

The exact thresholds should be configurable in the backend rather than hardcoded into the frontend.

---

# 32. Operational status

A separate operational status was created so that a broad analytical risk score does not override explicit inventory conditions.

Logic:

```text
IF predicted_demand > 0
AND closing_inventory < predicted_demand:
    Critical Shortage

ELSE IF predicted_coverage < 2:
    High Shortage Risk

ELSE IF wastage_risk >= 0.75:
    High Wastage Risk

ELSE IF spike_risk >= 0.30:
    Demand Spike Risk

ELSE IF predicted_coverage < 5:
    Monitor Inventory

ELSE:
    Stable
```

These operational statuses are more appropriate for dashboard alerts than a raw ML score.

---

# 33. Recommended actions

Initial action mapping:

```text
Critical
→ Urgent stock replenishment or transfer

High
→ Monitor closely and prepare replenishment

Medium
→ Monitor inventory

Low
→ No immediate action
```

The backend agent should integrate these into the existing action/alert model if one already exists.

---

# 34. Unified risk score

An analytical unified risk score was also tested:

```text
risk_score =
    0.50 × inventory_risk
  + 0.30 × spike_risk
  + 0.20 × inverse_predicted_coverage
```

where:

```text
inverse_predicted_coverage =
    1 / max(predicted_coverage, 1)
```

The result was clipped to:

```text
0 → 1
```

Important:

The weights:

```text
50% inventory
30% spike
20% coverage
```

are **heuristic**.

They were not learned or clinically optimized.

Do not present them as scientifically optimal.

The risk score is useful for prioritization, but explicit operational statuses should remain primary.

---

# 35. Risk-band validation

The analytical risk score was divided into quintiles.

Observed shortage rates increased substantially toward the highest risk band:

```text
Very Low → approximately 0
Low      → approximately 0
Medium   → approximately 0.019%
High     → approximately 0.248%
Very High→ approximately 16.4%
```

The thresholds were data-derived quintiles from the validation set.

These bands should be treated as analytical prioritization, not clinical/operational truth.

Do not allow a broad risk band to override a direct condition such as:

```text
inventory < predicted demand
```

---

# 36. Transfer / replenishment engine

The transfer engine was intentionally conservative.

Eligibility requires:

```text
same date
+
same blood group
+
same component
+
different blood bank
```

No clinical compatibility algorithm was implemented.

Do not invent compatibility rules.

Compatibility/crossmatching remains under existing blood-bank protocols.

---

# 37. Safety-stock heuristic

The initial safety stock was:

```text
safety_stock = predicted_demand × 2
```

Then:

```text
surplus_units =
    max(closing_inventory - safety_stock, 0)

deficit_units =
    max(safety_stock - closing_inventory, 0)
```

This is a **provisional configurable heuristic**.

It is not clinically validated.

The backend should make it configurable.

---

# 38. Transfer candidates

Potential donor:

```text
surplus_units >= 5
AND wastage_risk >= 0.50
```

Potential receiver:

```text
deficit_units >= 1
```

Initial candidate counts:

```text
Potential donors:    4,161
Potential receivers: 1,134
```

Donors were heavily concentrated in Platelets and PRBC.

---

# 39. Transfer matching algorithm

Receiver rows are sorted by:

```text
risk_score descending
deficit_units descending
```

For each receiver:

1. Find donor candidates.
2. Require same date.
3. Require same blood group.
4. Require same component.
5. Require different blood bank.
6. Require at least one available surplus unit.
7. Prefer donor with higher wastage risk.
8. Break ties using greater available surplus.
9. Transfer:

```text
min(receiver_deficit, donor_available_surplus)
```

Donor balances are reduced after every recommendation so that the same inventory cannot be allocated repeatedly.

Whole-unit receiver deficits were rounded up with:

```python
np.ceil(deficit_units)
```

---

# 40. Transfer results from Colab

The matching process produced:

```text
1,021 transfer recommendations
5,702 recommended transfer units
```

Constraint validation found:

```text
0 violations
```

Receiver outcomes:

```text
Receivers: 1,134
Receivers with transfer: 1,021
```

Reported categories:

```text
Resolved:            949
Partially Resolved:   72
Network Uncovered:   113
```

There were:

```text
185 receivers
```

with remaining deficits under the specific validation calculation.

Important caveat:

The safety-stock deficit can be fractional before whole-unit operational rounding. Therefore the historical Colab validation should not be interpreted as an exact unit-by-unit clinical resolution metric.

---

# 41. Transfer output structure

The Colab transfer table contained fields conceptually equivalent to:

```text
date
donor_bank
receiver_bank
blood_group
component_type
donor_surplus
receiver_deficit
recommended_transfer_units
donor_wastage_risk
receiver_risk_score
status
action
```

The backend agent should adapt this to existing transfer entities rather than creating a duplicate model if an equivalent one already exists.

---

# 42. Historical validation

The primary ML validation was a chronological holdout:

```text
Training:
2023-01-29 → 2024-09-30

Testing:
2024-10-01 onward
```

This is the primary evidence that the models can generalize to unseen historical data from the same dataset.

It is not evidence of real-world clinical accuracy.

The dataset is synthetic.

---

# 43. Synthetic-live simulation

A 60-day synthetic simulation was also attempted.

Initial state:

```text
2024-09-30
```

The simulation generated:

```text
2024-10-01 → 2024-11-29
```

for all:

```text
12 × 8 × 3 = 288
```

series per day.

Total simulated rows:

```text
17,280
```

The simulation was used as a system sanity check, not as real-world model validation.

Demand was sampled from historical distributions by:

```text
blood_bank_id
blood_group
component_type
day_of_week
```

Other operational flows were initially sampled similarly.

Stress events were introduced for:

```text
2024-10-10
2024-10-20
2024-11-01
2024-11-10
```

These represented examples such as demand spikes and reduced donations.

---

# 44. Synthetic-live results

Simulation summary:

```text
units_requested mean:      3.4211
units_requested std:       6.3940
units_requested max:     102

units_fulfilled mean:      3.2961
donations mean:             3.7538
transfers_in mean:          0.0909
transfers_out mean:         0.0750
units_wasted mean:          0.2930
units_expired mean:         0.2717

closing_inventory mean:   112.2386
closing_inventory max:   1227
```

Totals:

```text
Requested: 59,116
Fulfilled: 56,957
Fulfillment rate: ~96.35%
Shortage rows: 606
```

Demand model on the synthetic simulation:

```text
MAE:  2.1173
RMSE: 4.3562
```

Compared with historical holdout:

```text
MAE:  2.0235
RMSE: 4.1174
```

Spike model on synthetic simulation at threshold 0.30:

```text
Class 0 F1: ~0.95
Class 1 F1: ~0.58
Accuracy:   ~0.91
ROC-AUC:    ~0.938
```

---

# 45. Important simulation limitation

The synthetic simulator showed inventory drift.

Historical inventory mean:

```text
~79.36
```

Synthetic inventory mean:

```text
~112.24
```

The primary reason is that donations and transfers were initially sampled independently of inventory/demand.

In particular:

```text
mean donations > mean demand
```

which naturally caused stock accumulation.

The simulator also sampled transfers independently instead of using the actual transfer-matching engine.

This is a **simulation design issue**, not evidence that the ML models are wrong.

The synthetic simulation should therefore not be treated as a production data generator.

For future simulation work, use a closed-loop simulator where:

```text
demand
→ inventory
→ shortage/wastage logic
→ transfer engine
→ updated inventory
```

rather than independently sampling all flows.

This does not need to block the current backend integration.

---

# 46. What is already complete

The following work should be considered complete/frozen for the current integration:

```text
✓ Dataset inspection
✓ Data cleaning
✓ Time-series grouping
✓ Temporal feature engineering
✓ Chronological train/test split
✓ Demand forecasting model
✓ Demand spike-risk model
✓ Inventory shortage-risk model
✓ Wastage/expiry-risk model
✓ Baseline comparisons
✓ Model validation
✓ Model artifact saving
✓ Decision/risk engine logic
✓ Operational status logic
✓ Safety-stock heuristic
✓ Transfer candidate generation
✓ Constraint-aware transfer matching
✓ Transfer validation
✓ Initial synthetic-live sanity test
```

---

# 47. What the backend agent should implement

The integration should focus on:

## A. Model loading

Load once at application startup where practical.

Do not reload the `.pkl` files on every request unless the existing architecture requires it.

Suggested logical services:

```text
DemandForecastService
SpikeRiskService
InventoryRiskService
WastageRiskService
```

or a combined `MLPredictionService` if that better fits the existing codebase.

## B. Feature service

Reproduce the feature engineering required for inference.

It must generate:

- lag features
- rolling averages
- rolling maximums
- rolling standard deviation
- spike counts
- trend
- inventory history
- fulfillment history
- donation history
- transfer history
- wastage history
- expiry history
- target-day calendar features

All temporal features must be generated using data available **before the prediction target**.

## C. Decision service

Combine:

```text
predicted demand
spike risk
inventory risk
wastage risk
current inventory
predicted coverage
```

into operational statuses/actions.

## D. Transfer service

Implement the validated matching constraints.

Do not add clinical compatibility logic.

## E. Alert/monitoring service

Generate alerts for:

```text
Critical Shortage
High Shortage Risk
High Wastage Risk
Demand Spike Risk
Monitor Inventory
```

Use the existing notification infrastructure if present.

## F. Persistence

Persist predictions/risk assessments where the existing backend architecture supports historical monitoring.

Useful stored concepts:

```text
prediction date
blood bank
blood group
component
predicted demand
spike risk
inventory risk
wastage risk
coverage
operational status
recommended action
model version
```

## G. Model versioning

The backend should identify which model artifact generated a prediction.

At minimum, configuration should contain a model version such as:

```text
smartblood-ml-v1
```

Do not silently replace models without a version.

---

# 48. Recommended logical backend architecture

Adapt this to the existing repository rather than copying it literally:

```text
backend/
│
├── API routes
│
├── Services
│   ├── inventory service
│   ├── prediction service
│   ├── risk service
│   ├── transfer service
│   ├── alert service
│   └── simulation service
│
├── ML
│   ├── model loader
│   ├── feature builder
│   ├── demand predictor
│   ├── spike predictor
│   ├── inventory predictor
│   └── wastage predictor
│
├── Database
│
├── Schemas / DTOs
│
└── Configuration
```

Again, the existing project's architecture takes precedence.

---

# 49. API contract guidance

The backend agent should define the exact API contract because it has access to the existing services and frontend.

The APIs will likely need concepts equivalent to:

```text
Dashboard summary
Inventory status
Blood-bank detail
Demand forecast
Risk assessment
Alerts
Transfer recommendations
What-if simulation
```

The agent should reuse existing endpoints where possible rather than creating duplicate routes.

The response contract should expose meaningful operational information rather than raw model internals alone.

For example, the frontend should be able to obtain:

```text
current inventory
predicted demand
predicted coverage
spike risk
inventory risk
wastage risk
operational status
recommended action
```

---

# 50. Error handling requirements

The backend should gracefully handle:

- unknown blood bank IDs
- unknown blood groups
- unknown components
- insufficient historical data for lag/rolling features
- missing database records
- missing model artifacts
- model loading failure
- malformed prediction requests
- zero predicted demand
- missing inventory
- no eligible transfer donor
- partially covered transfer requirement

For insufficient history, the backend should not fabricate feature values silently.

Use the existing project's validation/error conventions.

---

# 51. Cold-start problem

The models rely heavily on historical lag and rolling features.

A new blood bank/group/component combination may not have enough history.

The integration should define a fallback using the existing project's data conventions.

Potential fallbacks include:

```text
insufficient-history status
historical aggregate
simple recent-demand baseline
or another explicitly configured fallback
```

Do not invent synthetic lag data in production.

The fallback should be clearly marked as a fallback prediction.

---

# 52. Data leakage warning

This is one of the most important integration requirements.

For a prediction made on date `D` for date `D+1`, the feature builder must not use:

```text
D+1 demand
D+1 inventory
D+1 fulfillment
D+1 wastage
D+1 expiry
```

or any other future information.

Rolling calculations should use historical records only.

The Colab implementation intentionally used:

```text
shift(1)
```

before rolling windows.

Preserve that behavior.

---

# 53. Real-time inference principle

The production system should conceptually operate as:

```text
Latest available state
        |
        v
Build historical feature window
        |
        v
Run frozen models
        |
        v
Calculate coverage/risk
        |
        v
Run decision engine
        |
        v
Generate alerts / recommendations
```

The system does not need to retrain models whenever new data arrives.

Training and inference are separate processes.

---

# 54. Retraining should be separate

Future retraining should be an offline workflow:

```text
New historical data
        |
        v
Data validation
        |
        v
Feature generation
        |
        v
Train candidate model
        |
        v
Validation
        |
        v
Compare with current model
        |
        v
Version new model
        |
        v
Deploy
```

Do not automatically retrain in an API request.

---

# 55. Dashboard priorities

The dashboard should emphasize operational meaning.

Recommended hierarchy:

```text
1. Critical shortages
2. High shortage risks
3. High wastage risks
4. Demand spikes
5. Transfer recommendations
6. Inventory coverage
7. Forecast details
8. Raw model scores
```

The user should not need to interpret an ML score to understand what action is suggested.

---

# 56. What-if simulation

A future simulation module can allow scenarios such as:

```text
Demand +20%
Demand +50%
Demand ×2
Donation reduction
Temporary bank outage
Component-specific demand spike
```

The simulation should reuse the same decision engine.

Conceptually:

```text
Current state
    +
Scenario changes
    ↓
Predicted demand/risk
    ↓
Inventory projection
    ↓
Shortage/wastage analysis
    ↓
Transfer recommendations
```

This is a future feature and should be architected so it can reuse existing services.

---

# 57. Important distinctions for the backend

Do not confuse:

```text
prediction
risk score
operational status
recommended action
```

They are different layers.

Example:

```text
Predicted demand:
24 units

Spike risk:
0.81

Inventory risk:
0.73

Predicted coverage:
0.75

Operational status:
Critical Shortage

Recommended action:
Urgent stock replenishment or transfer
```

This separation should remain visible in the backend model/schema.

---

# 58. Things NOT to do

Do not:

- retrain the models during integration
- fit a new OneHotEncoder on live data
- change feature order
- introduce future-data leakage
- treat risk scores as calibrated probabilities
- make ML inventory classification the sole shortage rule
- create clinical blood compatibility logic
- automatically authorize transfers
- replace existing hospital/blood-bank workflows
- build a second independent inventory system if one already exists
- duplicate existing backend entities
- expose `.pkl` files directly to clients
- hardcode thresholds into frontend code
- silently fabricate missing historical data
- claim synthetic-data performance is real-world clinical validation

---

# 59. Suggested integration testing

After integration, test the following.

## Model loading

```text
All 4 models load successfully
All 4 preprocessors load successfully
```

## Feature generation

For a known bank/group/component:

```text
feature names match training
feature order matches training
no unexpected NaNs
no future values
```

## Prediction

Verify:

```text
demand >= 0
risk scores within expected model output range
```

## Decision engine

Test cases:

```text
inventory < predicted demand
coverage < 2
coverage < 5
high spike risk
high wastage risk
stable inventory
```

## Transfer engine

Verify:

```text
same date
same group
same component
different banks
donor has enough remaining surplus
receiver deficit is respected
donor stock is not reused beyond available surplus
```

## API

Test:

```text
valid request
invalid bank
invalid blood group
invalid component
missing history
zero demand
no donor available
```

## End-to-end

```text
Database
→ feature builder
→ models
→ decision engine
→ transfer engine
→ API
→ frontend
```

---

# 60. Current model limitations

The backend/UI should not hide these.

## Synthetic data

The dataset is synthetic.

Therefore:

```text
Model metrics ≠ real-world clinical performance
```

Real deployment requires validation on real blood-bank data.

## Extreme demand spikes

The regression model underpredicts some extreme spikes.

The separate spike model exists partly to address this.

## Inventory classifier

The inventory classifier has high ROC-AUC but weaker precision for the positive shortage class at the default threshold.

Therefore deterministic inventory logic remains important.

## Wastage prediction

The wastage classifier detects risk reasonably well but generates false positives.

It should be treated as an alerting/ranking mechanism, not a certainty.

## Safety stock

Current:

```text
2 × predicted demand
```

is heuristic.

It should eventually be configurable and validated with operational experts.

## Risk-score weights

Current:

```text
50% inventory risk
30% spike risk
20% coverage
```

are heuristic.

They are not clinically optimized.

---

# 61. Resource contract for the coding AI agent

The agent should receive the following resources.

## Required

### 1. This handoff `.md` file

Contains:

- finalized ML methodology
- feature definitions
- model metrics
- thresholds
- decision logic
- transfer logic
- limitations

### 2. All eight model artifacts

```text
demand_forecast_model.pkl
demand_forecast_preprocessor.pkl

spike_risk_model.pkl
spike_risk_preprocessor.pkl

inventory_risk_model.pkl
inventory_risk_preprocessor.pkl

wastage_risk_model.pkl
wastage_risk_preprocessor.pkl
```

### 3. The SmartBlood dataset

At minimum:

```text
smartblood.csv
```

Preferably the complete original dataset used for development.

The backend agent needs this for:

- local development
- feature reconstruction
- historical data population
- integration testing

### 4. Existing backend repository

This is essential.

The agent needs to inspect:

- routes
- services
- database
- schemas
- authentication
- configuration
- existing inventory/request/transfer logic

### 5. Existing frontend repository

This is needed to understand:

- existing API expectations
- dashboard data requirements
- existing components
- state management
- authentication
- existing inventory views
- existing transfer/alert UI

---

# 62. Strongly recommended additional resources

### 6. Original Colab notebook

Share the complete `.ipynb`.

This is valuable because it contains:

- exact preprocessing
- exact feature-generation code
- training code
- validation
- model saving
- decision logic
- transfer matching

The `.md` file summarizes the work, but the notebook is the authoritative implementation reference.

### 7. Model output directory

Share the entire:

```text
outputs/
```

directory.

Do not manually rename the files.

### 8. Data dictionary

If available, share documentation explaining each dataset column.

### 9. Existing database schema/migrations

Especially useful if the backend already has:

```text
inventory
blood banks
requests
transfers
users
alerts
```

### 10. Existing backend README / architecture documentation

This lets the coding agent follow project conventions.

### 11. Existing environment/configuration example

For example:

```text
.env.example
```

Do not share actual secrets.

### 12. Existing API documentation

If the backend already has:

```text
OpenAPI
Swagger
Postman collection
API documentation
```

share it.

---

# 63. Optional resources

Useful but not strictly required:

```text
DIRECTORY.csv
LICENSED.csv
CAMPS.csv
COLLECTED.csv
ISSUED.csv
DISCARDED.csv
RATIO.csv
```

These can help the agent understand the broader blood-bank dataset and future network features.

Also useful:

```text
network_decisions.csv
final_transfer_df.csv
```

if they were exported from the Colab.

These are useful as expected-output references.

---

# 64. Recommended folder to give the agent

A clean handoff could look like:

```text
smartblood-ml-handoff/
│
├── README_ML_INTEGRATION.md
│
├── models/
│   ├── demand_forecast_model.pkl
│   ├── demand_forecast_preprocessor.pkl
│   ├── spike_risk_model.pkl
│   ├── spike_risk_preprocessor.pkl
│   ├── inventory_risk_model.pkl
│   ├── inventory_risk_preprocessor.pkl
│   ├── wastage_risk_model.pkl
│   └── wastage_risk_preprocessor.pkl
│
├── data/
│   └── smartblood.csv
│
├── notebooks/
│   └── smartblood_ml.ipynb
│
└── reference/
    ├── network_decisions.csv
    └── final_transfer_df.csv
```

The actual backend repository should remain separate or be provided as the main workspace.

---

# 65. Recommended agent instructions

The coding AI agent should be told:

```text
Treat the supplied ML artifacts as frozen production candidates.

Inspect the existing backend before implementing anything.

Integrate the models into the existing architecture rather than creating a parallel application.

Preserve the exact feature semantics and preprocessing used during training.

Do not fit preprocessors during inference.

Do not introduce future-data leakage.

Reuse existing database entities and services where possible.

Expose operational decisions through the backend, not raw model internals alone.

Keep prediction, risk score, operational status, and recommended action as separate concepts.

Keep transfer matching conservative:
same date + same blood group + same component + different bank.

Do not implement clinical compatibility/crossmatching logic.

Keep thresholds and heuristics configurable.

Do not claim the synthetic-data metrics represent real-world clinical accuracy.

Do not retrain the models unless explicitly requested.

Use the existing repository's framework, naming conventions, authentication, validation, database patterns, and API architecture.

After implementation, create automated tests covering model loading, feature generation, inference, decision logic, and transfer constraints.
```

---

# 66. Definition of successful integration

Integration is successful when:

```text
Existing backend
      |
      v
Current inventory/history
      |
      v
Exact training-compatible features
      |
      v
Frozen ML artifacts
      |
      v
Demand + Spike + Inventory + Wastage signals
      |
      v
Decision engine
      |
      +------------------+
      |                  |
      v                  v
Operational status    Transfer engine
      |                  |
      +--------+---------+
               |
               v
          Existing API
               |
               v
            Frontend
```

The frontend should be able to show, for each relevant blood-bank/group/component combination:

```text
Current inventory
Predicted next-day demand
Predicted coverage
Demand spike risk
Inventory shortage risk
Wastage/expiry risk
Operational status
Recommended action
Transfer recommendation where applicable
```

without independently implementing any ML logic.

---

# 67. Final implementation priority

Recommended order:

```text
1. Inspect existing backend architecture
2. Inspect existing inventory/request/transfer services
3. Add model artifacts
4. Implement model loader
5. Implement feature builder
6. Implement inference services
7. Implement decision/risk engine
8. Integrate transfer recommendation engine
9. Integrate alerts/monitoring
10. Persist prediction/risk results where appropriate
11. Add tests
12. Connect existing/new APIs to frontend
13. Validate complete end-to-end flow
14. Add what-if simulation
15. Prepare deployment configuration
```

The API contract, exact database mapping, and module placement should be determined by the coding agent after inspecting the existing repository.

The key requirement is to preserve the **behavior and assumptions of the finalized Colab ML system while integrating it cleanly into the existing SmartBlood product.**
