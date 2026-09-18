# Product Requirements Document
# SmartBlood — Smart Blood & Emergency Donor Network

**Version:** 1.0  
**Status:** Implementation-Ready  
**Project Name (Code):** bloodline  
**Problem Statement Reference:** PS-1

---

## 1. Product Overview

### 1.1 Product Name
**SmartBlood** — Smart Blood & Emergency Donor Network  
*(Internal project codename: bloodline)*

### 1.2 Problem Being Solved
During medical emergencies, patients and their families face critical delays in sourcing compatible blood. Information about blood availability is fragmented across blood banks, hospitals, voluntary donors, and informal contact networks. Even when a blood unit or eligible donor exists, determining whether it is:
- biologically compatible with the patient,
- available in the required quantity,
- reachable within the patient's time constraint, and
- still actually available (not already allocated or stale)

...is practically impossible through manual coordination under time pressure.

### 1.3 Why This Is a Dynamic Resource-Allocation Problem
SmartBlood is **not** a donor-search application or a blood-bank directory. It is a **dynamic resource-allocation system** because:

1. **Multiple patients compete simultaneously** for the same compatible blood types.
2. **Blood bank inventories change continuously** — units are added, reserved, expire, or are consumed.
3. **Donors become available or unavailable** in real time.
4. **Transportation constraints and travel time** change based on location and conditions.
5. **New emergency requests can arrive** at any time, potentially outranking existing allocations in urgency.
6. **Cancellations and failures mid-process** require immediate re-assessment and re-planning.
7. A decision made for one patient directly affects resource availability for others.

Treating this as a simple search or first-come-first-served problem causes avoidable delays and suboptimal resource utilisation.

### 1.4 Intended Purpose
SmartBlood is a **software prototype** that demonstrates an intelligent, real-time emergency blood coordination ecosystem. It connects hospitals, blood banks, and verified voluntary donors through a unified platform that:
- Processes emergency blood requirements as they arrive.
- Considers multiple allocation factors simultaneously (compatibility, urgency, quantity, location, scarcity, eligibility, and verification status).
- Dynamically re-plans when conditions change.
- Provides explainable, traceable allocation recommendations.
- Supports human-authorized confirmation at every allocation step.

> **Scope Disclaimer:** SmartBlood is a software prototype. It does not integrate with real hospital information systems, government blood-bank registries, or licensed clinical systems. All data used in demonstrations is synthetic. The system's recommendations are informational and require authorization by qualified human personnel before real-world action.

---

## 2. Problem Statement

> *During medical emergencies, patients and their families often struggle to arrange the required blood within a critical period of time. Information about blood availability is frequently scattered across blood banks, hospitals, voluntary donors, phone contacts, and messaging groups. A blood unit or donor may exist somewhere, but identifying whether it is compatible, currently available, reachable within the required time, and suitable for a particular patient can become difficult when the situation is continuously changing. At the same time, multiple patients may require the same blood group, blood-bank inventories may change, donors may become unavailable, transportation may be delayed, and new emergency requests may arrive with different levels of urgency. These circumstances make blood coordination a dynamic resource-allocation problem rather than a simple donor-search problem.*
>
> *Develop a software solution that enables patients, hospitals, blood banks, and verified voluntary donors to participate in a unified emergency blood coordination ecosystem. The system should process blood requirements and available resources in real time while considering factors such as blood-group compatibility, required quantity, patient urgency, donor eligibility and availability, blood-unit availability, location, estimated travel time, hospital requirements, resource scarcity, and changing demand.*
>
> *The solution should handle situations where multiple patients compete for limited compatible blood resources and should determine how available resources can be coordinated without relying solely on nearest-resource, first-come-first-served, or simple blood-group matching approaches. As new requests, donors, blood units, cancellations, transportation constraints, or availability updates occur, the system should continuously reassess the situation and modify its recommendations or allocations accordingly. When a preferred donor or blood unit becomes unavailable, the system should identify alternative feasible resources and support timely re-planning.*
>
> *The platform should provide authorized users with understandable explanations of why a particular donor, blood unit, or allocation was prioritized, along with relevant information about compatibility, urgency, availability, and estimated accessibility. The system should also incorporate appropriate verification mechanisms to reduce the risk of unreliable donor or inventory information being used during emergencies. Participants may design suitable mechanisms for communication, notifications, donor responses, blood-bank coordination, transportation assistance, and emergency request management as part of their solution.*
>
> *The proposed system should demonstrate how it can operate under changing and resource-constrained conditions where decisions made for one patient may affect the availability of resources for others. The objective is to build an intelligent and responsive blood emergency network that can reduce avoidable delays, improve coordination among stakeholders, and maximize the effective utilization of limited blood resources while ensuring that emergency requirements are appropriately prioritized.*

---

## 3. Goals

The following measurable software goals are derived directly from the problem statement:

| ID | Goal | Success Criterion |
|:---|:-----|:------------------|
| G-01 | **Unified Emergency Blood Coordination** | All actors (hospitals, blood banks, donors, coordinators) interact through a single platform. |
| G-02 | **Real-Time Availability Processing** | Changes to inventory, donor availability, or request status propagate to all connected clients within the session. |
| G-03 | **Blood Compatibility Consideration** | Every candidate resource is filtered through the implemented ABO/Rh compatibility matrix before being considered for allocation. |
| G-04 | **Required Quantity Consideration** | Allocation is only recommended when the available quantity can feasibly meet the requested quantity. |
| G-05 | **Patient Urgency Consideration** | A multi-level triage classification and computed urgency score influence allocation priority. |
| G-06 | **Donor Eligibility and Availability** | Donor eligibility status (as supplied by authorized personnel or configured rules) and real-time availability flag are verified before matching. |
| G-07 | **Blood-Unit Availability** | Blood units are queried in real time; only units with status AVAILABLE enter the matching candidate pool. |
| G-08 | **Location and Estimated Travel Time** | Candidate resources are scored using proximity distance (km) and estimated travel time derived from location data. |
| G-09 | **Hospital Requirements** | Component type (Whole Blood, PRBC, Platelets, FFP, Cryoprecipitate) is a mandatory matching filter. |
| G-10 | **Resource Scarcity Handling** | When compatible resources are scarce, the allocation engine factors scarcity into candidate scoring rather than treating all eligible candidates equally. |
| G-11 | **Changing Demand** | New requests arriving at any time are evaluated in the context of currently active requests and reserved resources. |
| G-12 | **Multiple Patients Competing** | The allocation engine considers all active requests together; resources reserved for one request are unavailable to others. |
| G-13 | **Dynamic Re-Planning** | Defined state-change events automatically trigger re-evaluation of affected allocations and recommendations. |
| G-14 | **Alternative Resource Identification** | When a preferred resource becomes unavailable, the system identifies the next-best feasible candidate. |
| G-15 | **Explainable Recommendations** | Every allocation recommendation exposes human-readable reasons listing the actual factors used by the algorithm. |
| G-16 | **Verification Mechanisms** | Donor availability information, blood-unit inventory, and hospital identity carry explicit verification/trust states. |
| G-17 | **Communication and Notification Support** | Key allocation events trigger in-app notifications to relevant actors; real-time updates are delivered via WebSocket. |

---

## 4. Non-Goals

The following are **explicitly out of scope** for this system:

| ID | Non-Goal |
|:---|:---------|
| NG-01 | **Does not replace medical professionals.** Allocation recommendations require human authorization before real-world action. |
| NG-02 | **Does not make clinical treatment decisions.** The system does not determine whether a patient requires blood transfusion. |
| NG-03 | **Does not independently determine medical donor eligibility.** Donor eligibility is based on status information supplied by authorized personnel or configured rules — not clinical examination performed by the software. |
| NG-04 | **Does not guarantee real-world blood availability.** Inventory data reflects what has been entered into the system; physical reality may differ. |
| NG-05 | **Does not automatically guarantee transportation.** Transportation estimates are computed from location data; actual logistics are coordinated by humans. |
| NG-06 | **Does not integrate with real hospital information systems, government blood-bank registries, or any external licensed medical system.** No such integration is implemented. |
| NG-07 | **Does not use real patient data.** All demonstration data is synthetic. |
| NG-08 | **Does not perform cross-matching or serological testing.** Physical blood compatibility testing must be performed by qualified blood-bank personnel. |
| NG-09 | **Does not claim regulatory approval.** This is a software prototype. |
| NG-10 | **Does not provide real SMS or push notification delivery.** Notification delivery is via in-app WebSocket events; external SMS/email/push are optional future integrations. |
| NG-11 | **Does not autonomously revoke a confirmed, in-transit allocation.** Once an allocation is HARD_LOCKED and IN_TRANSIT, re-planning operates on remaining unconfirmed resources. |
| NG-12 | **Does not use AI/ML models for core allocation decisions.** Core allocation is deterministic weighted scoring. |

---

## 5. Users / Actors

### 5.1 Hospital (Hospital Admin / Clinical Staff)

| Attribute | Detail |
|:----------|:-------|
| **Purpose** | Submit emergency blood requests on behalf of patients; track allocation progress. |
| **Permissions** | Create, update, cancel own requests; view allocation status and explanations for own requests; receive real-time notifications. |
| **Main Actions** | Submit emergency blood request; cancel request; view allocation explanation; monitor live request status. |
| **Information Visible** | Own requests and their status; matched donor or blood unit identifier (not full PII); estimated travel time; allocation rationale; notification feed. |

### 5.2 Blood Bank (Blood Bank Staff)

| Attribute | Detail |
|:----------|:-------|
| **Purpose** | Maintain accurate blood unit inventory; respond to inventory locks placed by the allocation engine. |
| **Permissions** | Add/update/mark inventory units; view own inventory and reservation locks; receive allocation notifications. |
| **Main Actions** | Register new blood units; update unit status (quarantine, expired, dispatched); view current reservation locks. |
| **Information Visible** | Own inventory units and their statuses; reservation lock details; notification feed for lock events. |

### 5.3 Verified Voluntary Donor (Donor)

| Attribute | Detail |
|:----------|:-------|
| **Purpose** | Register availability for emergency dispatch; respond to targeted proximity-zone broadcast alerts. |
| **Permissions** | Toggle own availability; update own location; respond to emergency dispatch requests (accept/decline); view own dispatch history. |
| **Main Actions** | Set availability status; update location; accept or decline an emergency dispatch alert. |
| **Information Visible** | Own profile; incoming dispatch alerts with hospital name, component requested, and estimated travel distance; own donation history. |

### 5.4 Authorized Coordinator / System Admin

| Attribute | Detail |
|:----------|:-------|
| **Purpose** | Oversee the entire coordination network; intervene manually in exceptional circumstances; manage verification and system configuration. |
| **Permissions** | View all active requests, allocations, and audit logs; manually override allocations; manage verification status of hospitals and blood banks; adjust system parameters. |
| **Main Actions** | Monitor live priority queue; inspect allocation explanations and audit logs; trigger manual re-planning; override allocation assignments; manage actor verification. |
| **Information Visible** | All active requests, allocations, donors, inventory, and audit events system-wide. |

### 5.5 Patient / Patient Representative

> **Implementation Decision:** In this prototype, patients themselves do not have direct system accounts. Emergency requests are submitted on their behalf by hospital staff. A `patient_id_token` field on the request record links the request to an anonymised patient identifier supplied by the hospital. This avoids collecting real patient PII in the prototype.

---

## 6. Core Use Cases

### UC-01: Create an Emergency Blood Request
A hospital staff member submits a blood request specifying the required blood group, component type, quantity (units), triage/urgency level, deadline, and the hospital's location. The system validates the request, assigns an urgency score, and triggers the allocation pipeline.

### UC-02: Update an Emergency Request
A hospital staff member updates urgency level or deadline on an active request. The system re-scores the request and triggers re-evaluation.

### UC-03: Cancel a Request
A hospital staff member cancels an active request (e.g., patient stabilised). The system releases any soft locks associated with the request and marks it CANCELLED. Affected donors and blood bank staff are notified.

### UC-04: Register / Maintain Donor Availability
A verified donor toggles their availability status and optionally updates their current location. The system updates their eligibility for future proximity broadcasts.

### UC-05: Respond to an Emergency Dispatch Alert (Donor)
A donor receives a proximity-zone broadcast notification. They accept or decline. On first acceptance, the system atomically claims an exclusive hard lock for that donor. All other zone donors receive a stand-down notification.

### UC-06: Record Blood-Unit Inventory (Blood Bank)
Blood bank staff registers a new blood unit with blood group, component type, volume, batch number, collection date, and expiry date. The unit enters the AVAILABLE pool and may immediately be considered for pending requests.

### UC-07: Update Blood-Unit Status (Blood Bank)
Blood bank staff marks a unit as quarantined, expired, or dispatched. The system updates availability and triggers re-planning for any pending requests that held a soft lock on that unit.

### UC-08: Compatibility-Based Resource Search
The allocation engine retrieves all candidate blood units and donors; filters by biological compatibility (ABO/Rh matrix for the required component type); filters by availability, verification status, and quantity feasibility; then ranks survivors by multi-factor scoring.

### UC-09: Prioritise Competing Requests
The engine holds all active requests in a priority queue ordered by computed urgency score. When resources are scarce, higher-urgency requests are served from the candidate pool first, but the engine considers feasibility for all active requests rather than simply satisfying the top request and leaving others unaddressed.

### UC-10: Allocate Resources
The engine attempts inventory-first allocation (FEFO). If inventory is insufficient, it broadcasts to the proximity-zone donor pool. Resources are reserved via soft locks until a hard lock is confirmed.

### UC-11: Re-Plan After Availability Change
When a trigger event is detected (donor cancels, inventory unit quarantined, lock times out), the engine releases the invalidated reservation, identifies alternative feasible resources, and generates a new recommendation.

### UC-12: Find Alternative Resources
When the preferred resource is unavailable, the engine expands the search radius or searches the next compatible donor/unit. The alternative recommendation includes an explanation of why the original was unavailable and why the alternative was selected.

### UC-13: Verification of Actors and Resources
Authorized coordinators can set and update verification status for hospitals, blood banks, and donors. Unverified or stale-data resources are excluded from or deprioritised in allocation matching.

### UC-14: Notifications
The system dispatches in-app WebSocket notifications to relevant actors on key events.

### UC-15: View Allocation Explanation
Authorized users retrieve the explanation object for any allocation decision. It lists the factors considered (compatibility result, quantity feasibility, urgency score, distance/travel-time estimate, scarcity level, verification status) and the rationale for the selected resource.

### UC-16: Transportation Coordination (Supported by Proximity Scoring)
The system estimates travel time using location-based distance calculations (PostGIS ST_Distance).

> **Implementation Decision:** A mock travel-time estimate based on distance / average speed is used for the prototype. A real routing provider can be plugged in later.

---

## 7. Functional Requirements

### Authentication and Authorization

| ID | Requirement |
|:---|:------------|
| FR-001 | The system shall support user registration with role selection: HOSPITAL_ADMIN, BLOOD_BANK_STAFF, DONOR, SYSTEM_ADMIN. |
| FR-002 | The system shall authenticate users via email and password. Passwords shall be stored as bcrypt hashes. |
| FR-003 | The system shall issue a signed JWT access token upon successful login. The token shall include the user's role. |
| FR-004 | All protected API endpoints shall require a valid JWT in the Authorization Bearer header. |
| FR-005 | The system shall enforce role-based access control (RBAC) on every endpoint. Actions outside a role's permissions shall return HTTP 403. |
| FR-006 | Hospital staff may only view and manage their own hospital's requests. |
| FR-007 | Blood bank staff may only view and manage their own blood bank's inventory. |
| FR-008 | Donors may only view and manage their own donor profile and respond to their own dispatched alerts. |
| FR-009 | SYSTEM_ADMIN role has read access to all entities and write access to verification records and system overrides. |

### Emergency Requests

| ID | Requirement |
|:---|:------------|
| FR-010 | The system shall allow hospital users to create an emergency blood request specifying: required blood group (one of: O-, O+, A-, A+, B-, B+, AB-, AB+), component type, quantity in units (positive integer), triage level, and deadline timestamp. |
| FR-011 | The system shall assign an urgency score (calculated_urgency_score, range 0-100) to each request at creation and on any deadline/triage update, using the implemented urgency scoring formula. |
| FR-012 | The system shall validate that deadline is in the future at request creation. |
| FR-013 | A new request shall be assigned status PENDING_EVALUATION upon creation. |
| FR-014 | Hospital users shall be able to cancel an active request. Cancelled requests shall release all associated soft locks and notify affected donors and blood bank staff. |
| FR-015 | The system shall support the following triage levels: MASSIVE_TRANSFUSION_PROTOCOL, ACTIVE_TRAUMA, SCHEDULED_EMERGENCY_RESERVE, ROUTINE_CLINICAL. |
| FR-016 | Request status transitions shall follow the defined state machine (see Architecture.md Section 10). |
| FR-017 | The system shall expose an endpoint to retrieve all requests for a hospital, filterable by status. |
| FR-018 | The system shall expose an endpoint to retrieve a single request with full detail including current allocation and explanation. |

### Blood Groups and Compatibility

| ID | Requirement |
|:---|:------------|
| FR-019 | The system shall implement the ABO/Rh red-blood-cell (RBC) compatibility matrix as documented in Section 10. |
| FR-020 | For FFP (plasma) components, the system shall implement the plasma compatibility matrix as documented in Section 10. |
| FR-021 | The compatibility check shall be the first filter applied to any candidate resource. |
| FR-022 | The system shall not apply plasma compatibility rules to RBC/Whole Blood/PRBC/Platelets requests, and vice versa. |

### Donor Management

| ID | Requirement |
|:---|:------------|
| FR-023 | Donors shall be able to register a profile including: blood group, date of birth, weight (kg), and optional last donation date. |
| FR-024 | Donors shall be able to toggle their availability (is_available boolean) and optionally update their current location (latitude, longitude). |
| FR-025 | The allocation engine shall only consider donors with is_available = true in proximity queries. |
| FR-026 | Donor eligibility status shall be tracked and exposed. The system shall not claim to perform clinical medical eligibility assessment. |
| FR-027 | Each donor shall carry a reliability_score (0.0-1.0) that is updated after each accept/decline/timeout event and influences candidate ranking. |
| FR-028 | Donors shall receive an emergency dispatch alert when they fall within the proximity zone of a matching request. |
| FR-029 | A donor responding ACCEPT shall trigger an atomic hard-lock upgrade via Redis compare-and-swap. |
| FR-030 | A donor responding DECLINE shall release their soft lock. |

### Blood-Bank Inventory Management

| ID | Requirement |
|:---|:------------|
| FR-031 | Blood bank staff shall be able to register a new blood unit with: blood group, component type, volume (ml), batch number (unique), collection date, and expiry date. |
| FR-032 | The system shall support the following unit statuses: AVAILABLE, LOCKED_RESERVE, DISPATCHED, TRANSFUSED, EXPIRED, QUARANTINED. |
| FR-033 | Blood bank staff shall be able to update a unit's status. |
| FR-034 | The allocation engine shall apply FEFO ordering when selecting from available inventory. |
| FR-035 | A lock_expires_at timestamp shall be set on a unit when it is soft-locked. If the lock expires without confirmation, the unit shall automatically return to AVAILABLE. |
| FR-036 | Inventory queries shall filter by unit status AVAILABLE and expiry date in the future. |

### Compatibility Engine

| ID | Requirement |
|:---|:------------|
| FR-037 | The compatibility engine shall accept a recipient blood group and component type and return the list of compatible donor blood groups from the implemented matrix. |
| FR-038 | The compatibility result shall be deterministic — the same input shall always produce the same output. |

### Resource Allocation Engine

| ID | Requirement |
|:---|:------------|
| FR-039 | On request creation (or re-plan trigger), the allocation engine shall execute the full pipeline: compatibility filter -> inventory check (FEFO) -> proximity-zone donor broadcast -> scoring -> recommendation. |
| FR-040 | The engine shall first attempt allocation from blood-bank inventory. If insufficient, it shall fall back to live-donor proximity broadcast. |
| FR-041 | Candidate scoring shall use the following factors: (a) compatibility (binary gate), (b) urgency score, (c) proximity distance (km), (d) expiry proximity for inventory units (FEFO), (e) donor reliability score. Specific weights are an Implementation Decision. |
| FR-042 | The engine shall not use first-come-first-served as the sole allocation criterion. |
| FR-043 | The engine shall not use nearest-resource as the sole allocation criterion. |
| FR-044 | The engine shall not use blood-group matching as the sole allocation criterion. |
| FR-045 | Resources reserved (soft-locked or hard-locked) for one request shall not be considered available for any other concurrent request. |
| FR-046 | The engine shall produce an AllocationAuditLog record for every allocation decision. |

### Dynamic Re-Planning

| ID | Requirement |
|:---|:------------|
| FR-047 | The system shall detect defined re-planning trigger events: donor cancels, lock timeout, unit status changes, request cancellation, new high-urgency request, zone TTL timeout. |
| FR-048 | Upon a re-planning trigger, the system shall: release invalidated locks, set request status to RE_PLANNING, re-execute the allocation pipeline, generate a new recommendation, notify relevant actors. |
| FR-049 | Re-planning shall expand the proximity search radius progressively if the initial radius yields no candidates. |

### Alternative Resources

| ID | Requirement |
|:---|:------------|
| FR-050 | When the initially recommended resource is no longer available, the system shall identify the next-best feasible candidate. |
| FR-051 | The alternative resource recommendation shall include the reason the original resource was invalidated. |

### Verification

| ID | Requirement |
|:---|:------------|
| FR-052 | Hospital and blood-bank accounts shall require coordinator/admin verification before creating requests or registering inventory. |
| FR-053 | Donor accounts shall carry a verification status flag. Only verified donors shall be included in proximity-zone broadcasts by default. |
| FR-054 | The system shall track verification timestamps. A configurable staleness period applies. |

### Notifications

| ID | Requirement |
|:---|:------------|
| FR-055 | The system shall deliver real-time in-app notifications via WebSocket on defined events. |
| FR-056 | Notification delivery shall be best-effort. Failure shall not fail the underlying transaction. |
| FR-057 | The notification system shall be abstracted so that an email/SMS provider can be added as an optional future integration. |

### Audit and History

| ID | Requirement |
|:---|:------------|
| FR-058 | The system shall record an immutable audit log entry for every allocation decision, re-plan, lock acquisition, lock release, and status transition. |
| FR-059 | Audit log entries shall be retrievable by SYSTEM_ADMIN and authorized HOSPITAL_ADMIN roles (for their own requests). |
| FR-060 | Audit log entries shall not be deletable via any API endpoint. |

---

## 8. Non-Functional Requirements

### Reliability
- NFR-01: The allocation pipeline shall be idempotent.
- NFR-02: Soft locks shall automatically expire if not upgraded to hard locks within the configured TTL.

### Availability
- NFR-03: *(Implementation Target)* The system should remain operational during local development and demonstration scenarios.
- NFR-04: Database and Redis containers should be independently restartable.

### Performance
- NFR-05: *(Implementation Target)* API endpoints should respond within a timeframe suitable for live demonstration.
- NFR-06: Geospatial proximity queries shall use PostGIS spatial indexing (ST_DWithin) to avoid full-table scans.

### Security
- NFR-07: All passwords shall be stored as bcrypt hashes. Plaintext passwords shall never be logged or stored.
- NFR-08: JWT tokens shall be signed with a configured secret key. Token expiration shall be configurable.
- NFR-09: All API endpoints shall validate input using Pydantic schemas before processing.
- NFR-10: RBAC shall be enforced at the application layer on every protected endpoint.

### Privacy
- NFR-11: The prototype shall use synthetic data only. Real patient identifiers shall not be collected.
- NFR-12: The patient_id_token field shall be an opaque identifier supplied by the hospital, not validated as real PII.
- NFR-13: Donor location data shall only be used for proximity calculations and shall not be exposed to hospital users in full detail.

### Auditability
- NFR-14: Every allocation, lock state change, and re-plan event shall produce an immutable audit record.

### Explainability
- NFR-15: The rationale_summary and candidate_scores_json fields of AllocationAuditLog shall contain sufficient information to reconstruct why a resource was selected.
- NFR-16: Explanations shall reference only factors actually used by the implemented algorithm.

### Scalability
- NFR-17: The modular architecture shall allow individual modules to be scaled or replaced independently.

### Maintainability
- NFR-18: Business logic (compatibility matrices, urgency scoring, allocation pipeline) shall reside in clearly separated service modules, not in API route handlers.

### Observability
- NFR-19: The backend shall emit structured log events for lifecycle transitions, allocation decisions, lock events, and errors.
- NFR-20: All allocation decisions shall be persisted in the allocation_audit_logs table.

### Data Consistency
- NFR-21: Resource reservation shall use Redis distributed locking with atomic compare-and-swap to prevent double-allocation race conditions.
- NFR-22: Database writes within the allocation pipeline shall use async SQLAlchemy transactions.

---

## 9. Business / Allocation Rules

### 9.1 Multi-Factor Allocation Model

The allocation engine shall **never** rely solely on nearest resource, first request received, or blood-group match.

| Factor | Description | Type |
|:-------|:------------|:-----|
| Biological Compatibility | Candidate passes ABO/Rh compatibility matrix | Binary gate |
| Patient Urgency Score | Computed from triage level and time remaining to deadline (0-100) | Priority factor |
| Quantity Feasibility | Available quantity >= requested quantity | Binary gate |
| Resource Availability Status | Unit AVAILABLE; donor is_available = true; no conflicting hard lock | Binary gate |
| Proximity / Estimated Travel Time | Distance (km) converted to proximity score (1.0 at hospital, 0.0 at boundary) | Continuous scoring factor |
| Expiry Proximity (FEFO) | Earlier-expiring inventory units preferred | Ordering factor |
| Donor Reliability Score | Historical accept/fulfil rate (0.0-1.0) | Continuous scoring factor |
| Verification Status | Unverified resources excluded or deprioritised | Filter / penalty factor |
| Resource Scarcity | Global supply context factored when resources are limited | Context-aware factor |

> **Implementation Decision:** The relative weights assigned to proximity score, donor reliability, and scarcity in the composite score are defined in the allocation service implementation and may be tuned.

### 9.2 Allocation Strategy Priority
1. **Blood-Bank Inventory First:** Check available, compatible, non-expired inventory units with FEFO ordering.
2. **Live Donor Fallback:** If inventory insufficient, broadcast to all eligible donors within initial proximity radius simultaneously.
3. **Radius Expansion:** If no donors respond within TTL, expand search radius progressively.

### 9.3 Competing Requests
- A resource locked (soft or hard) for one request is **unavailable** to any other request.
- Requests with higher urgency scores have priority access to the remaining candidate pool.
- The engine shall not permanently starve a lower-urgency request if compatible resources exist that are not needed by higher-urgency requests.

---

## 10. Compatibility

### 10.1 Scope
The implemented compatibility model covers ABO/Rh red-blood-cell (RBC) donor-to-patient compatibility for Whole Blood, PRBC, Platelets (RBC rules apply). For FFP, the plasma compatibility matrix (inverse of RBC) is implemented. Cryoprecipitate follows FFP rules by default.

> **Medical Disclaimer:** Software compatibility matching is not a substitute for physical cross-matching, serological testing, or clinical authorization by qualified blood-bank personnel. All transfusion decisions must be confirmed by qualified medical professionals.

### 10.2 RBC Compatibility Matrix (Recipient -> Compatible Donor Groups)

| Recipient | Compatible Donor Groups |
|:----------|:------------------------|
| O- | O- |
| O+ | O-, O+ |
| A- | O-, A- |
| A+ | O-, O+, A-, A+ |
| B- | O-, B- |
| B+ | O-, O+, B-, B+ |
| AB- | O-, A-, B-, AB- |
| AB+ | O-, O+, A-, A+, B-, B+, AB-, AB+ |

### 10.3 Plasma (FFP) Compatibility Matrix (Recipient -> Compatible Donor Groups)

| Recipient | Compatible Donor Groups |
|:----------|:------------------------|
| O- | O-, O+, A-, A+, B-, B+, AB-, AB+ |
| O+ | O+, A+, B+, AB+ |
| A- | A-, A+, AB-, AB+ |
| A+ | A+, AB+ |
| B- | B-, B+, AB-, AB+ |
| B+ | B+, AB+ |
| AB- | AB-, AB+ |
| AB+ | AB+ |

### 10.4 Important Notes
- Compatibility checking is the first and mandatory filter in the allocation pipeline.
- The matrices are statically defined in code (matching_service.py) and are deterministic.
- ABO subgroups, rare antibodies, antigen matching beyond ABO/Rh, and component-specific viability rules beyond expiry date are not modelled in this prototype.

---

## 11. Emergency Priority

### 11.1 Triage Levels and Base Urgency Scores

| Triage Level | Base Score | Time-to-Treatment Guideline |
|:-------------|:----------:|:----------------------------|
| MASSIVE_TRANSFUSION_PROTOCOL | 95 | < 15 minutes |
| ACTIVE_TRAUMA | 80 | < 1 hour |
| SCHEDULED_EMERGENCY_RESERVE | 50 | < 4 hours |
| ROUTINE_CLINICAL | 20 | < 24 hours |

### 11.2 Time-Based Urgency Modifier

| Minutes Remaining | Modifier |
|:-----------------:|:--------:|
| <= 15 | +20 |
| <= 60 | +10 |
| <= 240 | +5 |
| > 240 | 0 |

Final urgency score = min(100, base_score + modifier)

### 11.3 Urgency in Competing Allocation
- Higher urgency score -> higher priority in the active request queue.
- The engine does not automatically satisfy the highest-urgency request at the expense of making all others infeasible.
- If the highest-urgency request cannot be fulfilled by a given resource but a next-priority request can, the resource may be allocated to the feasible candidate.

---

## 12. Resource Allocation

### 12.1 Candidate Resources
1. Blood units in blood-bank inventory: status AVAILABLE, matching component type, not expired, biologically compatible.
2. Donors: verified, is_available = true, within search radius, biologically compatible.

### 12.2 Filtering Pipeline
```
Input: emergency request
Step 1: Compatibility filter (ABO/Rh matrix)  -> eliminates incompatible candidates
Step 2: Availability filter                   -> eliminates LOCKED, EXPIRED, QUARANTINED units; unavailable donors
Step 3: Quantity feasibility check            -> eliminates candidates where stock < requested
Step 4: Verification status check             -> excludes unverified resources (configurable)
Step 5: Proximity filter                      -> limits to configurable search radius
Survivors: feasible candidate pool
```

### 12.3 Allocation Steps
1. **Inventory-First:** Attempt to reserve the top-scored inventory unit using FEFO-ordered query with Redis distributed lock.
2. **Soft Lock:** Unit status changes to LOCKED_RESERVE, lock_expires_at is set.
3. **Proximity Broadcast (Donor Fallback):** Query all eligible donors within radius, place non-exclusive soft locks across all simultaneously, broadcast dispatch notification.
4. **Hard Lock (First-Ack):** First accepting donor triggers atomic Redis compare-and-swap. Success -> exclusive HARD_LOCKED allocation. All other zone donors receive stand-down notification.
5. **Confirmation:** Allocation record created, request status -> COMMITTED_IN_TRANSIT, AllocationAuditLog written.
6. **Release:** If hard lock cancelled, lock released, allocation status -> RE_OPTIMIZED, re-planning fires.
7. **Fulfilment:** On delivery confirmation, request status -> FULFILLED, blood unit -> TRANSFUSED or DISPATCHED.

### 12.4 Reservation and Concurrency
- Soft locks: Redis keys with TTL.
- Hard locks: Redis atomic compare-and-swap (SET NX) to prevent race conditions.
- Database writes: SQLAlchemy async transactions.

---

## 13. Dynamic Re-Planning

### 13.1 Re-Planning Trigger Events

| Event | Description |
|:------|:------------|
| New emergency request | Scarcity context may change. |
| Request update | Urgency score recalculated. |
| Request cancellation | Resources locked to cancelled request are released. |
| Donor cancels in transit | HARD_LOCKED donor signals cancellation; lock released. |
| Donor lock timeout | Soft lock TTL expires; lock released. |
| Blood unit quarantined/expired | Locked or available unit becomes unavailable. |
| Inventory stock added | New compatible unit becomes available for pending requests. |
| Donor becomes available | Donor toggles is_available = true; pending re-planning requests re-evaluated. |
| Proximity-zone TTL timeout | No donor in initial radius accepts within TTL; radius expansion triggered. |

### 13.2 Re-Planning Process
1. Detect trigger event.
2. Identify affected request(s).
3. Release invalidated locks (soft or hard).
4. Set affected request status to RE_PLANNING.
5. Broadcast RE_PLANNING notification to the hospital.
6. Re-execute the full allocation pipeline for the affected request.
7. Produce a new recommendation with updated explanation.
8. Notify relevant actors of the new recommendation.

### 13.3 Constraints on Re-Planning
- An IN_TRANSIT allocation with HARD_LOCKED status shall not be automatically revoked unless the donor signals cancellation or a coordinator manually overrides.
- Re-planning only affects requests in PENDING_EVALUATION, PROXIMITY_ZONE_NOTIFIED, or RE_PLANNING states.

---

## 14. Explainability

Every allocation recommendation and audit log entry shall expose the following fields:

| Field | Content |
|:------|:--------|
| decision_type | Type of allocation decision (INVENTORY_MATCH, FIRST_ACK_CLAIM, RE_PLAN_ALTERNATIVE) |
| urgency_score | Computed urgency score at time of decision |
| selected_resource_id | Identifier of the selected blood unit or donor |
| candidate_scores_json | JSON listing evaluated candidates and the scores/factors that led to selection |
| rationale_summary | Human-readable sentence explaining why this resource was selected |

Explanations shall contain only factors actually used by the implemented algorithm.

---

## 15. Verification

### 15.1 Verification States

| State | Description |
|:------|:------------|
| VERIFIED | Account or resource has been verified by an authorized coordinator. |
| UNVERIFIED | Registration is pending verification. |
| SUSPENDED | Account has been suspended by an admin. |

### 15.2 Verification Rules (Implementation Decision)
- For the prototype, verification is a boolean flag (is_verified) set by SYSTEM_ADMIN via the admin API.
- Unverified donors are excluded from proximity broadcast by default (configurable).
- Unverified hospitals cannot create emergency requests.
- Unverified blood banks cannot register inventory units.

### 15.3 Staleness
- Donor availability is considered potentially stale if last updated beyond a configurable threshold.
- Stale donors may be deprioritised or excluded from allocation according to configured rules.

---

## 16. Notifications

The system delivers real-time WebSocket notifications to connected clients on the following events:

| Event | Recipient(s) |
|:------|:------------|
| New emergency request created | SYSTEM_ADMIN and coordinators |
| Allocation matched (inventory) | Hospital; relevant blood bank |
| Proximity-zone broadcast initiated | All donors in the zone |
| First-ack hard lock claimed | Hospital (match confirmed); all other zone donors (stand-down) |
| All zone donors declined / zone timeout | Hospital (re-planning initiated) |
| Resource became unavailable | Hospital (re-planning initiated) |
| Re-planning started | Hospital |
| Alternative resource found | Hospital |
| Request fulfilled | Hospital |
| Request cancelled | Affected donors (stand-down); relevant blood bank (lock released) |

> **Implementation Note:** Notification system is a WebSocket pub/sub channel managed by FastAPI Connection Manager. Email/SMS/push delivery are not implemented in the prototype.

---

## 17. Audit Trail

The following events must produce an immutable AllocationAuditLog record:

| Event | Details Recorded |
|:------|:-----------------|
| Emergency request created | Request ID, hospital ID, blood group, component, quantity, triage, urgency score, timestamp |
| Request status transition | Request ID, from status, to status, timestamp |
| Allocation decision made | Request ID, decision type, resource ID, urgency score, candidate scores, rationale, timestamp |
| Soft lock acquired | Resource ID, request ID, TTL, timestamp |
| Hard lock acquired | Resource ID, request ID, donor ID, timestamp |
| Lock released | Resource ID, request ID, reason, timestamp |
| Re-plan triggered | Request ID, trigger event, previous resource ID, timestamp |
| Alternative resource selected | Request ID, new resource ID, rationale, timestamp |
| Request fulfilled | Request ID, allocation ID, timestamp |
| Request cancelled | Request ID, timestamp |
| Coordinator override | Allocation ID, old resource, new resource, coordinator ID, timestamp |

---

## 18. Data Entities

### User
| Field | Type | Notes |
|:------|:-----|:------|
| id | String (UUID) | Primary key |
| email | String | Unique, indexed |
| hashed_password | String | bcrypt |
| role | Enum | HOSPITAL_ADMIN, BLOOD_BANK_STAFF, DONOR, SYSTEM_ADMIN |
| is_active | Boolean | |
| is_verified | Boolean | Coordinator-set |
| created_at | DateTime | |
| updated_at | DateTime | |

### Hospital
| Field | Type | Notes |
|:------|:-----|:------|
| id | String (UUID) | Primary key |
| user_id | FK -> User | |
| name | String | |
| address | String | |
| contact_phone | String | |
| latitude | Float | |
| longitude | Float | |
| location | Geography(Point) | PostGIS spatial column |
| is_verified | Boolean | |

### BloodBank
| Field | Type | Notes |
|:------|:-----|:------|
| id | String (UUID) | Primary key |
| user_id | FK -> User | |
| name | String | |
| address | String | |
| contact_phone | String | |
| latitude | Float | |
| longitude | Float | |
| location | Geography(Point) | PostGIS spatial column |
| is_verified | Boolean | |

### Donor
| Field | Type | Notes |
|:------|:-----|:------|
| id | String (UUID) | Primary key |
| user_id | FK -> User | One-to-one |
| blood_group | String | e.g., O+, A- |
| date_of_birth | Date | |
| weight_kg | Float | |
| last_donation_date | Date | Nullable |
| is_available | Boolean | Availability toggle |
| reliability_score | Float | 0.0-1.0 |
| total_successful_donations | Integer | |
| location | Geography(Point) | PostGIS |
| latitude | Float | |
| longitude | Float | |

### InventoryUnit
| Field | Type | Notes |
|:------|:-----|:------|
| id | String (UUID) | Primary key |
| blood_bank_id | FK -> BloodBank | |
| batch_number | String | Unique |
| blood_group | String | |
| component_type | Enum | WHOLE_BLOOD, PRBC, PLATELETS, FFP, CRYOPRECIPITATE |
| volume_ml | Float | |
| collection_date | DateTime | |
| expiry_date | DateTime | Indexed |
| status | Enum | AVAILABLE, LOCKED_RESERVE, DISPATCHED, TRANSFUSED, EXPIRED, QUARANTINED |
| lock_expires_at | DateTime | Nullable |

### BloodRequest (EmergencyRequest)
| Field | Type | Notes |
|:------|:-----|:------|
| id | String (UUID) | Primary key |
| hospital_id | FK -> Hospital | |
| patient_id_token | String | Opaque hospital-supplied token |
| required_blood_group | String | |
| component_type | Enum | |
| units_requested | Integer | |
| triage_level | Enum | MASSIVE_TRANSFUSION_PROTOCOL, ACTIVE_TRAUMA, SCHEDULED_EMERGENCY_RESERVE, ROUTINE_CLINICAL |
| calculated_urgency_score | Float | 0-100 |
| deadline_at | DateTime | |
| status | Enum | PENDING_EVALUATION, PROXIMITY_ZONE_NOTIFIED, COMMITTED_IN_TRANSIT, RE_PLANNING, FULFILLED, CANCELLED, EXPIRED |

### Allocation
| Field | Type | Notes |
|:------|:-----|:------|
| id | String (UUID) | Primary key |
| request_id | FK -> BloodRequest | |
| source_type | Enum | BLOOD_BANK_INVENTORY, LIVE_DONOR |
| inventory_unit_id | FK -> InventoryUnit | Nullable |
| donor_id | FK -> Donor | Nullable |
| status | Enum | SOFT_LOCKED, HARD_LOCKED, IN_TRANSIT, COMPLETED, CANCELLED_BY_DONOR, TIMED_OUT, RE_OPTIMIZED |
| estimated_transit_minutes | Float | Nullable |
| distance_km | Float | Nullable |
| allocated_at | DateTime | |
| completed_at | DateTime | Nullable |

### AllocationAuditLog
| Field | Type | Notes |
|:------|:-----|:------|
| id | String (UUID) | Primary key |
| request_id | FK -> BloodRequest | |
| decision_type | String | INVENTORY_MATCH, FIRST_ACK_CLAIM, RE_PLAN_ALTERNATIVE |
| urgency_score | Float | |
| candidate_scores_json | JSONB | All evaluated candidates and scores |
| selected_resource_id | String | ID of chosen unit or donor |
| rationale_summary | String | Human-readable explanation |
| created_at | DateTime | Immutable |

---

## 19. API-Level Requirements

| Capability | Method | Actor |
|:-----------|:-------|:------|
| User registration | POST | All |
| User login / token issuance | POST | All |
| Get current user profile | GET | All (authenticated) |
| Create emergency blood request | POST | Hospital |
| Get single request with allocation status | GET | Hospital, Coordinator |
| List requests | GET | Hospital, Coordinator |
| Cancel a request | PATCH | Hospital |
| Get allocation explanation for a request | GET | Hospital, Coordinator |
| Donor: toggle availability + update location | PATCH | Donor |
| Donor: get active dispatch alert | GET | Donor |
| Donor: respond to dispatch (accept/decline) | POST | Donor |
| Blood bank: list own inventory | GET | Blood Bank |
| Blood bank: register new blood unit | POST | Blood Bank |
| Blood bank: update unit status | PATCH | Blood Bank |
| Admin: system overview / live queue | GET | Coordinator |
| Admin: override allocation | POST | Coordinator |
| Audit logs | GET | Coordinator |
| WebSocket: real-time event stream | WS | All (authenticated) |

---

## 20. Acceptance Criteria

### AC-01: One patient needs blood and a compatible resource exists
- **Given:** A hospital submits an emergency request for 2 units O+ PRBC, triage ACTIVE_TRAUMA.
- **When:** A blood bank has 3 available O- PRBC units (compatible per RBC matrix).
- **Then:** The allocation engine identifies the units, creates a LOCKED_RESERVE allocation, sets request status to COMMITTED_IN_TRANSIT, and records an audit log with rationale.

### AC-02: Multiple patients compete for the same limited resource
- **Given:** Two active requests exist: Request A (O-, 2 units, MASSIVE_TRANSFUSION_PROTOCOL) and Request B (O+, 1 unit, ACTIVE_TRAUMA). Only 2 O- PRBC units are available.
- **When:** The allocation engine evaluates both requests.
- **Then:** Request A's higher urgency score causes it to be served first. Request B triggers the donor proximity broadcast since no inventory remains.

### AC-03: A preferred resource becomes unavailable
- **Given:** Request A has a soft lock on Unit U1. Before the lock is upgraded to hard, Unit U1 is marked quarantined.
- **When:** The inventory unit status changes to QUARANTINED.
- **Then:** The soft lock is released, request status changes to RE_PLANNING, engine re-executes, finds next compatible resource, and hospital receives a WebSocket notification.

### AC-04: A new emergency request arrives
- **Given:** Resources are being allocated for an existing ACTIVE_TRAUMA request.
- **When:** A new MASSIVE_TRANSFUSION_PROTOCOL request arrives for the same blood group.
- **Then:** The new request is scored with the highest urgency, added to the active queue, and the allocation engine re-evaluates the global candidate pool.

### AC-05: A new blood unit becomes available
- **Given:** Request R is in RE_PLANNING status with no compatible inventory.
- **When:** A blood bank registers a new compatible blood unit.
- **Then:** The allocation engine re-evaluates pending re-planning requests, identifies the new unit, and generates a new recommendation.

### AC-06: A donor becomes unavailable
- **Given:** Donor D has a soft lock for Request R, and donor D sets their availability to false.
- **When:** The availability update is processed.
- **Then:** D's soft lock is released; zone broadcast continues with remaining donors or re-planning triggered.

### AC-07: Transportation becomes delayed
- **Given:** A donor has a hard lock and is IN_TRANSIT. The donor sends a cancellation event.
- **When:** The cancellation event is processed.
- **Then:** The hard lock is released, allocation status changes to RE_OPTIMIZED, request status changes to RE_PLANNING, and the re-planning pipeline fires.

### AC-08: No feasible compatible resource exists
- **Given:** An emergency request for a rare blood group where no compatible inventory or available donors exist.
- **When:** The allocation engine completes its full search including radius expansion.
- **Then:** The request remains in RE_PLANNING status, the hospital receives a notification that no compatible resource was found.

### AC-09: A recommendation needs an explanation
- **Given:** An allocation has been made for a request.
- **When:** An authorized user requests the explanation.
- **Then:** The system returns the AllocationAuditLog record including decision_type, urgency_score, candidate_scores_json, selected_resource_id, and rationale_summary.

### AC-10: Inventory / availability information is stale or unverified
- **Given:** A donor is marked unverified (verification flag not set by coordinator).
- **When:** The allocation engine searches for donors.
- **Then:** The unverified donor is excluded from the proximity broadcast by default. The behaviour is logged in the audit trail.
