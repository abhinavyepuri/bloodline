import unittest
from datetime import datetime, timezone, date
from pydantic import ValidationError
from starlette.testclient import TestClient

from app.main import app
from app.core.permissions import UserRole, RoleChecker
from app.models.inventory import BloodComponentType, UnitStatus
from app.models.request import TriageLevel, RequestStatus
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.user import UserOut
from app.schemas.request import BloodRequestCreate, BloodRequestOut
from app.schemas.donor import DonorCreate, DonorUpdateAvailability, DonorOut, DonorHeartbeatIn, DonorTelemetryOut
from app.schemas.inventory import InventoryUnitCreate, InventoryUnitUpdateStatus, InventoryUnitOut
from app.schemas.allocation import DonorRespondRequest
from app.schemas.audit import AllocationAuditLogOut
from app.schemas.admin import AdminOverviewOut, AdminOverrideRequest


class TestStrictNormalizationAndValidation(unittest.TestCase):

    def test_role_case_insensitivity(self):
        """Verify that role strings in any case normalize to UserRole enum."""
        self.assertEqual(UserRole("hospital"), UserRole.HOSPITAL)
        self.assertEqual(UserRole("HOSPITAL"), UserRole.HOSPITAL)
        self.assertEqual(UserRole("Hospital"), UserRole.HOSPITAL)
        self.assertEqual(UserRole("blood_bank"), UserRole.BLOOD_BANK)
        self.assertEqual(UserRole("BLOOD_BANK"), UserRole.BLOOD_BANK)
        self.assertEqual(UserRole("donor"), UserRole.DONOR)
        self.assertEqual(UserRole("DONOR"), UserRole.DONOR)
        self.assertEqual(UserRole("coordinator"), UserRole.COORDINATOR)
        self.assertEqual(UserRole("admin"), UserRole.ADMIN)

    def test_role_checker_case_insensitivity(self):
        """Verify that RoleChecker handles casing seamlessly."""
        checker = RoleChecker([UserRole.HOSPITAL])
        checker("hospital")
        checker("HOSPITAL")
        checker("Hospital")
        
        with self.assertRaises(Exception) as ctx:
            checker("donor")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_register_request_normalization(self):
        """Verify that RegisterRequest normalizes email, role, and strips whitespace."""
        req = RegisterRequest(
            email="  TestUser@Example.COM  ",
            password="secretpassword123",
            full_name="  Dr. John Doe  ",
            phone_number="  +1234567890  ",
            role="hospital"
        )
        self.assertEqual(req.email, "testuser@example.com")
        self.assertEqual(req.role, UserRole.HOSPITAL)
        self.assertEqual(req.full_name, "Dr. John Doe")
        self.assertEqual(req.phone_number, "+1234567890")

    def test_register_request_extra_fields_forbidden(self):
        """Verify strict JSON forbids unexpected keys."""
        with self.assertRaises(ValidationError):
            RegisterRequest(
                email="user@example.com",
                password="password123",
                full_name="User",
                phone_number="1234567",
                role="donor",
                unexpected_field="hack"
            )

    def test_login_request_normalization(self):
        """Verify that LoginRequest normalizes email and forbids extra fields."""
        req = LoginRequest(
            email="  Doctor@HOSPITAL.ORG  ",
            password="password123"
        )
        self.assertEqual(req.email, "doctor@hospital.org")

        with self.assertRaises(ValidationError):
            LoginRequest(
                email="doctor@hospital.org",
                password="password123",
                extra_param="not_allowed"
            )

    def test_blood_request_create_normalization(self):
        """Verify that BloodRequestCreate normalizes blood groups, component types, and triage levels."""
        now = datetime.now(timezone.utc)
        req = BloodRequestCreate(
            patient_id_token=" patient-999 ",
            required_blood_group=" o+ ",
            component_type="ffp",
            units_requested=2,
            triage_level="active_trauma",
            deadline_at=now
        )
        self.assertEqual(req.required_blood_group, "O+")
        self.assertEqual(req.component_type, BloodComponentType.FFP)
        self.assertEqual(req.triage_level, TriageLevel.ACTIVE_TRAUMA)
        self.assertEqual(req.units_requested, 2)

    def test_donor_schemas_normalization(self):
        """Verify Donor schemas normalize blood groups and enforce GPS constraints."""
        donor_in = DonorCreate(
            blood_group=" ab- ",
            date_of_birth=date(1990, 5, 20),
            weight_kg=75.0,
            latitude=12.9716,
            longitude=77.5946
        )
        self.assertEqual(donor_in.blood_group, "AB-")

        with self.assertRaises(ValidationError):
            DonorUpdateAvailability(is_available=True, latitude=120.0, longitude=77.0)

    def test_inventory_schemas_normalization(self):
        """Verify Inventory schemas normalize blood group, batch, component type, and status."""
        now = datetime.now(timezone.utc)
        unit_in = InventoryUnitCreate(
            batch_number="  batch-001  ",
            blood_group=" a+ ",
            component_type="prbc",
            volume_ml=450.0,
            collection_date=now,
            expiry_date=now
        )
        self.assertEqual(unit_in.batch_number, "BATCH-001")
        self.assertEqual(unit_in.blood_group, "A+")
        self.assertEqual(unit_in.component_type, BloodComponentType.PRBC)

        status_update = InventoryUnitUpdateStatus(status="locked_reserve")
        self.assertEqual(status_update.status, UnitStatus.LOCKED_RESERVE)

    def test_donor_respond_normalization(self):
        """Verify DonorRespondRequest normalizes action to uppercase and supports optional request_id."""
        resp = DonorRespondRequest(action="accept")
        self.assertEqual(resp.action, "ACCEPT")
        self.assertIsNone(resp.request_id)

        resp_with_code = DonorRespondRequest(action="accept", request_id="REQ-8492")
        self.assertEqual(resp_with_code.action, "ACCEPT")
        self.assertEqual(resp_with_code.request_id, "REQ-8492")

        resp_dec = DonorRespondRequest(action="DECLINE", request_id="uuid-1234-5678")
        self.assertEqual(resp_dec.action, "DECLINE")
        self.assertEqual(resp_dec.request_id, "uuid-1234-5678")

        with self.assertRaises(ValidationError):
            DonorRespondRequest(action="invalid_action")

    def test_donor_heartbeat_schema(self):
        """Verify DonorHeartbeatIn validates coordinates and forbids extra fields."""
        hb = DonorHeartbeatIn(latitude=12.9716, longitude=77.5946)
        self.assertEqual(hb.latitude, 12.9716)
        self.assertEqual(hb.longitude, 77.5946)

        with self.assertRaises(ValidationError):
            DonorHeartbeatIn(latitude=95.0, longitude=77.0)

        with self.assertRaises(ValidationError):
            DonorHeartbeatIn(latitude=12.0, longitude=77.0, extra="unwanted")

    def test_donor_telemetry_out_emits_client_aliases(self):
        """Web dashboard reads both canonical telemetry names and allocation-style aliases."""
        out = DonorTelemetryOut(
            donor_id="donor-1",
            latitude=12.974,
            longitude=77.5946,
            distance_to_hospital_km=3.2,
            estimated_eta_minutes=8,
            is_approaching_ward=False,
            message="In transit",
        )
        payload = out.model_dump()
        self.assertEqual(payload["distance_to_hospital_km"], 3.2)
        self.assertEqual(payload["distance_km"], 3.2)
        self.assertEqual(payload["estimated_eta_minutes"], 8)
        self.assertEqual(payload["estimated_transit_minutes"], 8)
        self.assertFalse(payload["geofence_triggered"])

    def test_donor_out_includes_location_updated_at(self):
        """Verify DonorOut schema includes location_updated_at field."""
        now = datetime.now(timezone.utc)
        donor_dict = {
            "id": "donor-123",
            "user_id": "user-123",
            "blood_group": "O-",
            "date_of_birth": date(1995, 1, 1),
            "weight_kg": 65.0,
            "is_available": True,
            "reliability_score": 0.95,
            "total_successful_donations": 3,
            "latitude": 12.97,
            "longitude": 77.59,
            "location_updated_at": now,
            "created_at": now,
        }
        out = DonorOut(**donor_dict)
        self.assertEqual(out.location_updated_at, now)

    def test_request_code_generation(self):
        """Verify that generate_request_code produces readable REQ-XXXX format."""
        from app.models.request import generate_request_code
        code1 = generate_request_code()
        code2 = generate_request_code()
        self.assertTrue(code1.startswith("REQ-"))
        self.assertEqual(len(code1), 8)
        self.assertNotEqual(code1, code2)

    def test_admin_schemas_validation(self):
        """Verify Admin schemas validate and format strictly."""
        overview = AdminOverviewOut(
            active_requests_count=5,
            available_inventory_units_count=42,
            active_donors_count=18,
            recent_allocations_count=10,
            system_status="HEALTHY"
        )
        self.assertEqual(overview.active_requests_count, 5)

        override_req = AdminOverrideRequest(
            donor_id="donor-123",
            reason="Direct clinical coordinator assignment"
        )
        self.assertEqual(override_req.donor_id, "donor-123")


class TestResponseModelTransformations(unittest.TestCase):

    def test_user_out_transformation(self):
        now = datetime.now(timezone.utc)
        data = {
            "id": "u-123",
            "email": "user@example.com",
            "full_name": "Dr. Sarah Connor",
            "phone_number": "1234567890",
            "role": "hospital",
            "is_active": True,
            "is_verified": True,
            "created_at": now,
            "updated_at": now
        }
        user_out = UserOut.model_validate(data)
        self.assertEqual(user_out.role, UserRole.HOSPITAL)
        self.assertEqual(user_out.id, "u-123")

    def test_blood_request_out_transformation(self):
        now = datetime.now(timezone.utc)
        data = {
            "id": "req-123",
            "hospital_id": "hosp-456",
            "patient_id_token": "token-789",
            "required_blood_group": "O+",
            "component_type": "PRBC",
            "units_requested": 2,
            "triage_level": "ACTIVE_TRAUMA",
            "calculated_urgency_score": 85.0,
            "deadline_at": now,
            "status": "PENDING_EVALUATION",
            "created_at": now
        }
        req_out = BloodRequestOut.model_validate(data)
        self.assertEqual(req_out.component_type, BloodComponentType.PRBC)
        self.assertEqual(req_out.status, RequestStatus.PENDING_EVALUATION)

    def test_donor_out_transformation(self):
        now = datetime.now(timezone.utc)
        data = {
            "id": "don-123",
            "user_id": "usr-456",
            "blood_group": "O+",
            "date_of_birth": date(1995, 1, 1),
            "weight_kg": 72.5,
            "last_donation_date": None,
            "is_available": True,
            "reliability_score": 0.95,
            "total_successful_donations": 4,
            "latitude": 12.9716,
            "longitude": 77.5946,
            "created_at": now
        }
        donor_out = DonorOut.model_validate(data)
        self.assertEqual(donor_out.id, "don-123")
        self.assertEqual(donor_out.reliability_score, 0.95)

    def test_inventory_out_transformation(self):
        now = datetime.now(timezone.utc)
        data = {
            "id": "inv-123",
            "blood_bank_id": "bb-456",
            "batch_number": "B1234",
            "blood_group": "A+",
            "component_type": "FFP",
            "volume_ml": 450.0,
            "collection_date": now,
            "expiry_date": now,
            "status": "AVAILABLE",
            "created_at": now
        }
        inv_out = InventoryUnitOut.model_validate(data)
        self.assertEqual(inv_out.status, UnitStatus.AVAILABLE)

    def test_allocation_audit_log_out_transformation(self):
        now = datetime.now(timezone.utc)
        data = {
            "id": "log-1",
            "request_id": "req-1",
            "allocation_id": "alloc-1",
            "decision_type": "INVENTORY_MATCH",
            "urgency_score": 90.0,
            "candidate_scores_json": {"distance": 2.5, "score": 0.9},
            "selected_resource_id": "res-1",
            "rationale_summary": "Optimal candidate chosen",
            "created_at": now
        }
        log_out = AllocationAuditLogOut.model_validate(data)
        self.assertEqual(log_out.decision_type, "INVENTORY_MATCH")


class TestAPIEndpointsStrictJSON(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_health_endpoints(self):
        """Verify /health and /api/v1/health return strict JSON 200."""
        r1 = self.client.get("/health")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json()["status"], "healthy")

        r2 = self.client.get("/api/v1/health")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["status"], "healthy")

    def test_strict_json_validation_error_format(self):
        """Verify invalid payloads produce strict JSON validation error response."""
        res = self.client.post("/api/v1/auth/login", json={"email": "not-an-email"})
        self.assertEqual(res.status_code, 422)
        data = res.json()
        self.assertEqual(data.get("error_type"), "VALIDATION_ERROR")
        self.assertIn("detail", data)
        self.assertIsInstance(data["detail"], list)

        res2 = self.client.post("/api/v1/auth/register", json={
            "email": "valid@email.com",
            "password": "validpassword",
            "full_name": "Test",
            "phone_number": "12345678",
            "role": "hospital",
            "extra_unwanted": 123
        })
        self.assertEqual(res2.status_code, 422)
        self.assertEqual(res2.json().get("error_type"), "VALIDATION_ERROR")


if __name__ == "__main__":
    unittest.main()
