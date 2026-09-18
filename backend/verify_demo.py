"""
End-to-end smoke check for the Section 14 synthetic scenario.

Runs against a **live** backend (``uvicorn app.main:app``) plus PostgreSQL/PostGIS and
Redis from ``docker compose``. The equivalent logic is covered by
``tests/test_allocation_wave2.py`` against the in-process ASGI app; this script exists to
exercise the real HTTP surface and WebSocket-adjacent plumbing that only a running server
provides.

Usage:
    # terminal 1
    docker compose up -d db redis
    python -m app.init_db && python -m app.seed
    uvicorn app.main:app --reload

    # terminal 2
    python verify_demo.py

Requires ``DEBUG=true`` because it re-seeds the database through ``POST /admin/reset-seed``,
which is refused for everyone outside development.

Exits non-zero and names the step that failed if any expectation does not hold.
"""

import asyncio
import sys
from datetime import datetime, timedelta, timezone

import httpx

BASE_URL = "http://127.0.0.1:8000"
API = f"{BASE_URL}/api/v1"
PASSWORD = "password123"

failures: list[str] = []


def check(condition: bool, description: str) -> bool:
    """Record one expectation. Returns the condition so callers can branch on it."""
    if condition:
        print(f"   [ok]   {description}")
    else:
        print(f"   [FAIL] {description}")
        failures.append(description)
    return condition


def deadline_in(hours: int) -> str:
    """An absolute UTC deadline. Relative so the script does not rot."""
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


async def login(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        f"{API}/auth/login", json={"email": email, "password": PASSWORD}
    )
    response.raise_for_status()
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def run_demo() -> int:
    print("=" * 62)
    print("SECTION 14 SYNTHETIC SCENARIO — END-TO-END SMOKE CHECK")
    print("=" * 62)

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client:
        # ------------------------------------------------------------------
        # Step 0 — reset to the known synthetic state
        # ------------------------------------------------------------------
        print("\n0. Resetting the database")
        admin_headers = await login(client, "admin@smartblood.org")

        anon_reset = await client.post(f"{API}/admin/reset-seed")
        check(
            anon_reset.status_code in (401, 403),
            f"anonymous reset is refused (got {anon_reset.status_code})",
        )

        reset = await client.post(f"{API}/admin/reset-seed", headers=admin_headers)
        check(reset.status_code == 200, f"admin reset succeeds (got {reset.status_code})")
        if reset.status_code != 200:
            return report()

        # ------------------------------------------------------------------
        # Step 1 — Hospital raises a 2-unit O- PRBC request (MTP triage)
        # ------------------------------------------------------------------
        print("\n1. Request RA — 2 units O- PRBC, massive transfusion protocol")
        hosp_headers = await login(client, "hospital@smartblood.org")

        ra_response = await client.post(
            f"{API}/requests",
            headers=hosp_headers,
            json={
                "patient_id_token": "PT-DEMO-RA-TRAUMA",
                "required_blood_group": "O-",
                "component_type": "PRBC",
                "units_requested": 2,
                "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
                "deadline_at": deadline_in(2),
            },
        )
        check(ra_response.status_code == 201, f"RA created (got {ra_response.status_code})")
        if ra_response.status_code != 201:
            print(f"   body: {ra_response.text}")
            return report()

        ra = ra_response.json()
        ra_id = ra["id"]
        print(f"   RA {ra_id[:8]} | urgency {ra['calculated_urgency_score']}")

        # Both seeded O- units (BB-001, BB-002) should be reserved from inventory, and
        # a fully covered request is the only thing that reports COMMITTED_IN_TRANSIT.
        check(ra["units_covered"] == 2, f"RA covered 2 of 2 (got {ra['units_covered']})")
        check(ra["units_shortfall"] == 0, f"RA shortfall 0 (got {ra['units_shortfall']})")
        check(
            ra["status"] == "COMMITTED_IN_TRANSIT",
            f"RA is COMMITTED_IN_TRANSIT (got {ra['status']})",
        )
        inventory_allocations = [
            a for a in ra["allocations"] if a["source_type"] == "BLOOD_BANK_INVENTORY"
        ]
        check(
            len(inventory_allocations) == 2,
            f"2 inventory allocations (got {len(inventory_allocations)})",
        )
        check(
            all(a["distance_km"] is not None for a in inventory_allocations),
            "inventory allocations carry a real PostGIS distance (not a hardcoded 0.9)",
        )

        # ------------------------------------------------------------------
        # Step 2 — A second request, with O- inventory now exhausted
        # ------------------------------------------------------------------
        print("\n2. Request RB — 1 unit O- PRBC, active trauma (no stock left)")
        rb_response = await client.post(
            f"{API}/requests",
            headers=hosp_headers,
            json={
                "patient_id_token": "PT-DEMO-RB-SURGERY",
                "required_blood_group": "O-",
                "component_type": "PRBC",
                "units_requested": 1,
                "triage_level": "ACTIVE_TRAUMA",
                "deadline_at": deadline_in(3),
            },
        )
        check(rb_response.status_code == 201, f"RB created (got {rb_response.status_code})")
        if rb_response.status_code != 201:
            print(f"   body: {rb_response.text}")
            return report()

        rb = rb_response.json()
        check(rb["units_covered"] == 0, f"RB has no coverage yet (got {rb['units_covered']})")
        check(
            rb["status"] in ("PROXIMITY_ZONE_NOTIFIED", "RE_PLANNING"),
            f"RB fell through to donor alerting (got {rb['status']})",
        )

        # ------------------------------------------------------------------
        # Step 3 — BB-001 is quarantined; RA must re-plan one unit
        # ------------------------------------------------------------------
        print("\n3. Quarantining BB-001 (contamination) — RA must re-plan")
        bb_headers = await login(client, "bloodbank@smartblood.org")

        inventory = (await client.get(f"{API}/inventory", headers=bb_headers)).json()
        bb001 = next((u for u in inventory if u["batch_number"] == "BB-001"), None)
        if not check(bb001 is not None, "BB-001 is visible to its owning blood bank"):
            return report()

        quarantined = await client.patch(
            f"{API}/inventory/units/{bb001['id']}/status",
            headers=bb_headers,
            json={"status": "QUARANTINED"},
        )
        check(
            quarantined.status_code == 200 and quarantined.json()["status"] == "QUARANTINED",
            f"BB-001 quarantined (got {quarantined.status_code})",
        )

        ra_after = (await client.get(f"{API}/requests/{ra_id}", headers=hosp_headers)).json()
        check(
            ra_after["units_covered"] == 1,
            f"RA dropped to 1 covered unit after the loss (got {ra_after['units_covered']})",
        )
        check(
            ra_after["units_shortfall"] == 1,
            f"RA now short by 1 (got {ra_after['units_shortfall']})",
        )
        check(
            ra_after["status"] != "COMMITTED_IN_TRANSIT",
            f"RA no longer claims to be en route (got {ra_after['status']})",
        )

        # ------------------------------------------------------------------
        # Step 4 — Donor D1 (Alice, O-) accepts and closes the gap
        # ------------------------------------------------------------------
        print("\n4. Donor D1 accepts RA — claims the free unit slot")
        d1_headers = await login(client, "alice@donor.org")

        alerts = await client.get(f"{API}/donors/requests/active", headers=d1_headers)
        if check(alerts.status_code == 200, f"Alice can read her alert feed (got {alerts.status_code})"):
            alert_ids = {a["id"] for a in alerts.json()}
            check(ra_id in alert_ids, "RA is in Alice's alert zone (she was alerted on re-plan)")
            ra_alert = next((a for a in alerts.json() if a["id"] == ra_id), None)
            if ra_alert is not None:
                ttl = ra_alert.get("alert_expires_in_seconds")
                check(
                    ttl is not None and ttl > 0,
                    f"the alert carries a live response countdown (got {ttl})",
                )

        response = await client.post(
            f"{API}/donors/requests/{ra_id}/respond",
            headers=d1_headers,
            json={"action": "ACCEPT"},
        )
        check(response.status_code == 200, f"D1 accept succeeded (got {response.status_code})")
        if response.status_code != 200:
            print(f"   body: {response.text}")
            return report()

        accept = response.json()
        print(
            f"   claimed slot {accept.get('slot')} | "
            f"{accept.get('distance_km')} km | ETA {accept.get('estimated_transit_minutes')} min"
        )
        check(accept.get("slot") is not None, "the donor was given a concrete unit slot")
        check(
            accept.get("units_covered") == 2,
            f"RA is back to 2 covered (got {accept.get('units_covered')})",
        )
        check(accept.get("shortfall") == 0, f"no shortfall remains (got {accept.get('shortfall')})")

        ra_final = (await client.get(f"{API}/requests/{ra_id}", headers=hosp_headers)).json()
        check(
            ra_final["status"] == "COMMITTED_IN_TRANSIT",
            f"RA is COMMITTED_IN_TRANSIT (got {ra_final['status']})",
        )
        donor_allocations = [
            a for a in ra_final["allocations"] if a["source_type"] == "LIVE_DONOR"
        ]
        check(len(donor_allocations) == 1, f"one live-donor allocation (got {len(donor_allocations)})")

        # A donor may only hold one slot per request. By this point RA is fully covered
        # and therefore closed to further responses, so a repeat ACCEPT is refused —
        # either as ALREADY_CLAIMED while the zone is still open, or as a 409 once it is.
        again = await client.post(
            f"{API}/donors/requests/{ra_id}/respond",
            headers=d1_headers,
            json={"action": "ACCEPT"},
        )
        if again.status_code == 200:
            check(
                again.json().get("status") == "ALREADY_CLAIMED",
                f"repeat ACCEPT reports ALREADY_CLAIMED (got {again.text[:120]})",
            )
        else:
            check(
                again.status_code == 409,
                f"repeat ACCEPT is refused (got {again.status_code} {again.text[:120]})",
            )

        ra_after_double = (await client.get(f"{API}/requests/{ra_id}", headers=hosp_headers)).json()
        check(
            ra_after_double["units_covered"] == 2,
            f"the double claim did not add coverage (got {ra_after_double['units_covered']})",
        )

        # ------------------------------------------------------------------
        # Step 5 — Fulfilment and the audit trail
        # ------------------------------------------------------------------
        print("\n5. Fulfilment and the audit trail")
        fulfilled = await client.post(f"{API}/requests/{ra_id}/fulfill", headers=hosp_headers)
        check(fulfilled.status_code == 200, f"RA fulfils (got {fulfilled.status_code})")
        if fulfilled.status_code == 200:
            check(
                fulfilled.json()["status"] == "FULFILLED",
                f"RA is FULFILLED (got {fulfilled.json()['status']})",
            )

        # RB is short by one unit, so it must refuse to be signed off.
        rb_unfulfillable = await client.post(f"{API}/requests/{rb['id']}/fulfill", headers=hosp_headers)
        check(
            rb_unfulfillable.status_code == 409,
            f"RB refuses fulfilment while a unit is outstanding (got {rb_unfulfillable.status_code})",
        )

        logs = await client.get(f"{API}/audit/requests/{ra_id}/explanation", headers=hosp_headers)
        check(logs.status_code == 200, f"audit explanation is readable (got {logs.status_code})")
        if logs.status_code == 200:
            entries = logs.json()
            check(len(entries) > 0, f"RA has audit entries ({len(entries)})")
            for entry in entries:
                print(f"   [{entry['decision_type']}] {entry['rationale_summary']}")

        # ------------------------------------------------------------------
        # Step 6 — Cross-tenant isolation, live over HTTP
        # ------------------------------------------------------------------
        print("\n6. Tenant isolation")
        stjude_headers = await login(client, "stjude@smartblood.org")
        foreign_read = await client.get(f"{API}/requests/{ra_id}", headers=stjude_headers)
        check(
            foreign_read.status_code == 403,
            f"another hospital cannot read RA (got {foreign_read.status_code})",
        )

        donor_reads_board = await client.get(f"{API}/requests", headers=d1_headers)
        check(
            donor_reads_board.status_code == 403,
            f"a donor cannot read the request board (got {donor_reads_board.status_code})",
        )

    return report()


def report() -> int:
    print("\n" + "=" * 62)
    if failures:
        print(f"FAILED — {len(failures)} expectation(s) did not hold:")
        for item in failures:
            print(f"  • {item}")
        print("=" * 62)
        return 1
    print("PASSED — every expectation held.")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run_demo()))
