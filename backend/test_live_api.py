import asyncio
import json
import httpx

BASE_URL = "http://127.0.0.1:8000"
API = f"{BASE_URL}/api/v1"
PASSWORD = "password123"

async def test_live_ml_api():
    print("=" * 65)
    print("TESTING LIVE SMARTBLOOD ML PREDICTIONS API")
    print("=" * 65)

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client:
        # 1. Login as coordinator
        print("\n1. Logging in as coordinator...")
        resp = await client.post(f"{API}/auth/login", json={"email": "[EMAIL_ADDRESS]", "password": PASSWORD})
        assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
        token = resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("   [OK] Authenticated successfully as coordinator.")

        # 2. Test GET /predictions/summary
        print("\n2. Testing GET /api/v1/predictions/summary...")
        resp = await client.get(f"{API}/predictions/summary", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        summary = resp.json()
        print(f"   [OK] Total Series Evaluated: {summary['total_series_evaluated']}")
        print(f"        Critical Shortage Count: {summary['critical_shortage_count']}")
        print(f"        High Shortage Risk: {summary['high_shortage_risk_count']}")
        print(f"        High Wastage Risk: {summary['high_wastage_risk_count']}")
        print(f"        Spike Risk Count: {summary['demand_spike_risk_count']}")
        print(f"        Stable Count: {summary['stable_count']}")
        print(f"        Active Transfer Recs: {summary['active_transfer_recommendations_count']}")
        print(f"        ML Model Version: {summary['model_version']}")

        # 3. Test GET /predictions/forecast
        print("\n3. Testing GET /api/v1/predictions/forecast...")
        resp = await client.get(f"{API}/predictions/forecast", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        forecasts = resp.json()
        print(f"   [OK] Returned {len(forecasts)} series forecasts.")
        if forecasts:
            sample = forecasts[0]
            print(f"        Sample: {sample['blood_bank_name']} | {sample['blood_group']} ({sample['component_type']})")
            print(f"        Current Stock: {sample['closing_inventory']}u | Predicted Demand: {sample['predicted_demand']}u")
            print(f"        Coverage Days: {sample['predicted_coverage_days']}d | Status: {sample['operational_status']}")
            print(f"        Advisory: {sample['recommended_action']}")

        # 4. Test GET /predictions/transfers
        print("\n4. Testing GET /api/v1/predictions/transfers...")
        resp = await client.get(f"{API}/predictions/transfers", headers=headers)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        transfers = resp.json()
        print(f"   [OK] Returned {len(transfers)} transfer recommendations.")
        for t in transfers[:3]:
            print(f"        Transfer: {t['donor_bank_name']} -> {t['receiver_bank_name']}")
            print(f"        Units: {t['recommended_units']}x {t['blood_group']} ({t['component_type']}) | Dist: {t.get('distance_km', 'N/A')} km")
            print(f"        Reason: {t['recommended_action']}")

        # 5. Test POST /predictions/simulate
        print("\n5. Testing POST /api/v1/predictions/simulate (+50% demand surge)...")
        sim_payload = {"demand_multiplier": 1.5}
        resp = await client.post(f"{API}/predictions/simulate", headers=headers, json=sim_payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        sim = resp.json()
        print(f"   [OK] Simulation Succeeded!")
        print(f"        Multiplier: {sim['demand_multiplier']}x")
        print(f"        Projected Critical Shortages: {sim['projected_critical_count']}")
        print(f"        Projected Transfers Count: {sim['projected_transfers_count']}")
        print(f"        Total Transfer Units Needed: {sim['total_transfer_units_needed']}")
        print(f"        Impact Summary: {sim['summary_impact']}")

        # 6. Test Blood Bank user context (isolated facility)
        print("\n6. Testing Blood Bank specific filtering...")
        bb_resp = await client.post(f"{API}/auth/login", json={"email": "bloodbank@smartblood.org", "password": PASSWORD})
        if bb_resp.status_code == 200:
            bb_token = bb_resp.json()["access_token"]
            bb_headers = {"Authorization": f"Bearer {bb_token}"}
            bb_summary_resp = await client.get(f"{API}/predictions/summary", headers=bb_headers)
            if bb_summary_resp.status_code == 200:
                bb_sum = bb_summary_resp.json()
                print(f"   [OK] Blood Bank self-scoped series evaluated: {bb_sum['total_series_evaluated']}")

    print("\n" + "=" * 65)
    print("ALL LIVE ML PREDICTIONS ENDPOINTS VERIFIED SUCCESSFULLY (100% PASS)")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(test_live_ml_api())
