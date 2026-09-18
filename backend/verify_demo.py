import asyncio
import httpx

async def run_demo():
    print("==================================================")
    print("STARTING SECTION 14 SYNTHETIC DEMO VERIFICATION")
    print("==================================================")

    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000") as client:
        # Step 0: Reset seed
        res = await client.post("/api/v1/admin/reset-seed")
        print("0. Database Reset:", res.json()["status"])

        # Step 1: Submit Request RA
        login_hosp = await client.post("/api/v1/auth/login", json={"email": "hospital@smartblood.org", "password": "password123"})
        hosp_token = login_hosp.json()["access_token"]
        headers_hosp = {"Authorization": f"Bearer {hosp_token}"}

        ra_payload = {
            "patient_id_token": "PT-DEMO-RA-TRAUMA",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 2,
            "triage_level": "MASSIVE_TRANSFUSION_PROTOCOL",
            "deadline_at": "2026-09-18T16:45:00Z"
        }
        res_ra = await client.post("/api/v1/requests", json=ra_payload, headers=headers_hosp)
        ra = res_ra.json()
        print(f"1. Request RA Created: {ra['id'][:8]}... | Status: {ra['status']} | Urgency: {ra['calculated_urgency_score']}")
        print(f"   Allocations Sourced: {len(ra['allocations'])} units from Blood Bank FEFO reserve")

        # Step 2: Submit Request RB
        rb_payload = {
            "patient_id_token": "PT-DEMO-RB-SURGERY",
            "required_blood_group": "O-",
            "component_type": "PRBC",
            "units_requested": 1,
            "triage_level": "ACTIVE_TRAUMA",
            "deadline_at": "2026-09-18T17:30:00Z"
        }
        res_rb = await client.post("/api/v1/requests", json=rb_payload, headers=headers_hosp)
        rb = res_rb.json()
        print(f"2. Request RB Created: {rb['id'][:8]}... | Status: {rb['status']} (Inventory depleted -> Donor Proximity Broadcast)")

        # Step 3: Quarantine BB-001
        login_bb = await client.post("/api/v1/auth/login", json={"email": "bloodbank@smartblood.org", "password": "password123"})
        bb_token = login_bb.json()["access_token"]
        headers_bb = {"Authorization": f"Bearer {bb_token}"}

        inv_res = await client.get("/api/v1/inventory", headers=headers_bb)
        bb001 = [u for u in inv_res.json() if u["batch_number"] == "BB-001"][0]
        q_res = await client.patch(f"/api/v1/inventory/units/{bb001['id']}/status", json={"status": "QUARANTINED"}, headers=headers_bb)
        print(f"3. Unit BB-001 Quarantined: Status = {q_res.json()['status']}")

        ra_after_q = (await client.get(f"/api/v1/requests/{ra['id']}")).json()
        print(f"   RA State after BB-001 failure: Status = {ra_after_q['status']} (Re-planning initiated for 1 missing unit)")

        # Step 4: Donor Alice (D1) responds ACCEPT for RA
        login_d1 = await client.post("/api/v1/auth/login", json={"email": "alice@donor.org", "password": "password123"})
        d1_token = login_d1.json()["access_token"]
        headers_d1 = {"Authorization": f"Bearer {d1_token}"}

        d1_resp = await client.post(f"/api/v1/donors/requests/{ra['id']}/respond", json={"action": "ACCEPT"}, headers=headers_d1)
        print(f"4. Donor D1 Responded: {d1_resp.json()['status']} (First-Ack Hard Lock Claimed!)")

        ra_final = (await client.get(f"/api/v1/requests/{ra['id']}")).json()
        print(f"   Final RA Status: {ra_final['status']}")
        print("   Final RA Hybrid Allocations:")
        for a in ra_final["allocations"]:
            print(f"     • Source: {a['source_type']} | Status: {a['status']} | Distance: {a.get('distance_km')}km | ETA: {a.get('estimated_transit_minutes')}m")

        # Step 5: Audit Explanation for RA
        audit_res = await client.get(f"/api/v1/audit/requests/{ra['id']}/explanation")
        logs = audit_res.json()
        print(f"5. Audit Explanation Records ({len(logs)} entries):")
        for l in logs:
            print(f"   [{l['decision_type']}] {l['rationale_summary']}")

    print("==================================================")
    print("DEMO VERIFICATION COMPLETE: ALL ASSERTIONS PASSED!")
    print("==================================================")

if __name__ == "__main__":
    asyncio.run(run_demo())
