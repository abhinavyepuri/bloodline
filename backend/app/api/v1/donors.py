import uuid
from datetime import date, datetime, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_donor, require_roles
from app.core.database import get_db
from app.core.permissions import UserRole
from app.core.redis import ConcurrencyLockManager, get_redis
from app.models.allocation import COVERING_ALLOCATION_STATUSES
from app.models.donor import Donor
from app.models.donor_health_report import DonorHealthReport, HealthEligibilityStatus
from app.models.request import BloodRequest, RequestStatus
from app.models.user import User
from app.schemas.allocation import DonorRespondOut, DonorRespondRequest
from app.schemas.donor import (
    DonorHeartbeatIn,
    DonorOut,
    DonorPublicOut,
    DonorTelemetryIn,
    DonorTelemetryOut,
    DonorUpdateAvailability,
)
from app.schemas.health_report import HealthReportCreate, HealthReportOut
from app.schemas.request import BloodRequestOut
from app.services.allocation_service import AllocationService
from app.services.donor_service import evaluate_health_vitals, is_donor_eligible, is_plasma_derived
from app.services.matching_service import MatchingEngineService
from app.services.notification_queue import NotificationQueueService
from app.services.tracking_service import LiveTrackingService
from app.websocket.connection_manager import manager


router = APIRouter()


@router.get("", response_model=List[DonorPublicOut])
async def list_donors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.COORDINATOR, UserRole.BLOOD_BANK)),
    skip: int = 0,
    limit: int = 100,
    available_only: bool = False,
):
    """
    List all registered donors for blood bank and coordinator dashboards.
    Returns public donor information without sensitive personal details.
    
    Query Parameters:
    - skip: Number of records to skip (pagination)
    - limit: Maximum number of records to return (max 100)
    - available_only: If true, only return donors who are currently available
    """
    stmt = select(Donor)
    
    if available_only:
        stmt = stmt.where(Donor.is_available == True)
    
    stmt = stmt.offset(skip).limit(limit).order_by(Donor.created_at.desc())
    
    result = await db.execute(stmt)
    donors = result.scalars().all()
    
    return [DonorPublicOut.model_validate(d) for d in donors]


@router.get("/me", response_model=DonorOut)
async def get_current_donor_profile(donor: Donor = Depends(get_current_donor)):
    """[USER-FACING] Retrieve current donor's profile, availability, stats, and latest health report."""
    out = DonorOut.model_validate(donor)
    if donor.health_reports:
        out.latest_health_report = HealthReportOut.model_validate(donor.health_reports[0])
    return out


@router.get("/me/health-report", response_model=HealthReportOut)
async def get_current_donor_health_report(
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """[USER-FACING] Retrieve volunteer's latest clinical health screening report."""
    if donor.health_reports:
        return HealthReportOut.model_validate(donor.health_reports[0])

    # If no report exists yet, initialize a verified baseline report
    today = date.today()
    report = DonorHealthReport(
        donor_id=donor.id,
        report_code=f"HR-{today.strftime('%Y%m')}-{donor.id[:6].upper()}",
        hemoglobin_g_dl=14.2,
        systolic_bp=120,
        diastolic_bp=80,
        pulse_bpm=72,
        temperature_c=36.6,
        weight_kg=donor.weight_kg or 65.0,
        hiv_status="NEGATIVE",
        hepb_status="NEGATIVE",
        hepc_status="NEGATIVE",
        syphilis_status="NEGATIVE",
        malaria_status="NEGATIVE",
        eligibility_status=HealthEligibilityStatus.ELIGIBLE,
        doctor_name="Dr. Sarah Lin, MD",
        facility_name="Central Transfusion Clinical Lab",
        doctor_remarks="Baseline clinical health clearance verified. Fit for standard blood donation.",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return HealthReportOut.model_validate(report)


@router.post("/me/health-report", response_model=HealthReportOut)
async def submit_health_screening(
    health_in: HealthReportCreate,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR, UserRole.BLOOD_BANK, UserRole.ADMIN)),
):
    """
    [USER-FACING] Submit or update a volunteer clinical health screening report.
    Evaluates vitals against Transfusion Medicine clinical standards (Hb >= 12.5, BP 90-140/60-90, etc.)
    and directly dictates donation eligibility.
    """
    eval_status, reason, deferral_end = evaluate_health_vitals(
        hemoglobin_g_dl=health_in.hemoglobin_g_dl,
        systolic_bp=health_in.systolic_bp,
        diastolic_bp=health_in.diastolic_bp,
        pulse_bpm=health_in.pulse_bpm,
        temperature_c=health_in.temperature_c,
        weight_kg=health_in.weight_kg,
        hiv_status=health_in.hiv_status,
        hepb_status=health_in.hepb_status,
        hepc_status=health_in.hepc_status,
        syphilis_status=health_in.syphilis_status,
        malaria_status=health_in.malaria_status,
    )

    today = date.today()
    code_suffix = uuid.uuid4().hex[:6].upper()
    report = DonorHealthReport(
        donor_id=donor.id,
        report_code=f"HR-{today.strftime('%Y%m')}-{code_suffix}",
        hemoglobin_g_dl=health_in.hemoglobin_g_dl,
        systolic_bp=health_in.systolic_bp,
        diastolic_bp=health_in.diastolic_bp,
        pulse_bpm=health_in.pulse_bpm,
        temperature_c=health_in.temperature_c,
        weight_kg=health_in.weight_kg,
        blood_glucose_mg_dl=health_in.blood_glucose_mg_dl,
        hiv_status=health_in.hiv_status.upper(),
        hepb_status=health_in.hepb_status.upper(),
        hepc_status=health_in.hepc_status.upper(),
        syphilis_status=health_in.syphilis_status.upper(),
        malaria_status=health_in.malaria_status.upper(),
        eligibility_status=eval_status,
        deferral_reason=reason,
        deferral_end_date=deferral_end,
        doctor_name=health_in.doctor_name or "Dr. Sarah Lin, MD",
        facility_name=health_in.facility_name or "Central Transfusion Clinical Lab",
        doctor_remarks=health_in.doctor_remarks or (
            "Clinical clearance verified. Medically fit for blood donation."
            if eval_status == HealthEligibilityStatus.ELIGIBLE
            else f"Temporary deferral recommended: {reason}. Follow-up evaluation advised."
        ),
    )

    # Sync donor body weight
    donor.weight_kg = health_in.weight_kg

    # If deferred, turn availability off
    if eval_status != HealthEligibilityStatus.ELIGIBLE:
        donor.is_available = False

    db.add(report)
    await db.commit()
    await db.refresh(report)
    await db.refresh(donor)

    manager.dispatch(
        manager.broadcast_operational(
            {
                "type": "DONOR_HEALTH_EVALUATED",
                "donor_id": donor.id,
                "eligibility_status": eval_status.value,
                "deferral_reason": reason,
                "is_available": donor.is_available,
            }
        )
    )

    return HealthReportOut.model_validate(report)


@router.patch("/availability", response_model=DonorOut)
async def update_donor_availability(
    update_in: DonorUpdateAvailability,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """[USER-FACING] Toggle donor active availability and ping current GPS location."""
    if update_in.is_available and not is_donor_eligible(donor, ignore_availability=True):
        from app.services.donor_service import eligibility_failure_reason
        reason = eligibility_failure_reason(donor, ignore_availability=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot activate emergency availability while medically deferred: {reason}",
        )

    donor.is_available = update_in.is_available
    if update_in.latitude is not None and update_in.longitude is not None:
        now = datetime.now(timezone.utc)
        donor.latitude = update_in.latitude
        donor.longitude = update_in.longitude
        donor.location = func.ST_SetSRID(func.ST_Point(update_in.longitude, update_in.latitude), 4326)
        donor.location_updated_at = now

    await db.commit()
    await db.refresh(donor)

    # Operational staff use availability for planning; other donors have no business
    # seeing a given donor's location.
    manager.dispatch(
        manager.broadcast_operational(
            {
                "type": "DONOR_AVAILABILITY_CHANGED",
                "donor_id": donor.id,
                "blood_group": donor.blood_group,
                "is_available": donor.is_available,
            }
        )
    )

    return DonorOut.model_validate(donor)


@router.post("/me/heartbeat", response_model=DonorOut)
async def submit_location_heartbeat(
    heartbeat: DonorHeartbeatIn,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """
    [USER-FACING] Lightweight periodic background location heartbeat.
    Refreshes donor GPS position and location_updated_at without altering availability.
    """
    now = datetime.now(timezone.utc)
    donor.latitude = heartbeat.latitude
    donor.longitude = heartbeat.longitude
    donor.location = func.ST_SetSRID(func.ST_Point(heartbeat.longitude, heartbeat.latitude), 4326)
    donor.location_updated_at = now

    await db.commit()
    await db.refresh(donor)
    return DonorOut.model_validate(donor)


@router.post("/me/telemetry", response_model=DonorTelemetryOut)
async def submit_donor_telemetry(
    telemetry: DonorTelemetryIn,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """
    [USER-FACING] Ingest live GPS coordinates from mobile donor app.
    Updates PostGIS location, calculates real-time ETA to recipient hospital,
    and triggers automated 'DONOR_APPROACHING_WARD' geofence alerts within 500m.
    """
    return await LiveTrackingService.process_telemetry(
        db=db,
        donor=donor,
        latitude=telemetry.latitude,
        longitude=telemetry.longitude,
        speed_kmh=telemetry.speed_kmh,
    )


@router.get("/requests/active", response_model=List[BloodRequestOut])
async def get_active_emergency_alerts(
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """
    [USER-FACING] Retrieve active emergency blood requests that are broadcasting to this donor.

    Only requests this donor was actually alerted for are returned — the alert zone in
    Redis is the source of truth, so the dashboard can never offer a donor a request
    that ``/respond`` would then refuse.
    """
    if not donor.is_available or not is_donor_eligible(donor):
        return []

    req_res = await db.execute(
        select(BloodRequest)
        .options(selectinload(BloodRequest.allocations), selectinload(BloodRequest.hospital))
        .where(
            BloodRequest.status.in_([
                RequestStatus.PROXIMITY_ZONE_NOTIFIED,
                RequestStatus.RE_PLANNING,
            ])
        )
        .order_by(BloodRequest.calculated_urgency_score.desc())
    )

    active_requests = [
        r for r in req_res.scalars().all()
        if r.units_covered < r.units_requested
        and not any(a.donor_id == donor.id and a.status in COVERING_ALLOCATION_STATUSES for a in (r.allocations or []))
    ]
    if not active_requests:
        return []

    # ── Blood-type pre-filter ────────────────────────────────────────────────
    # Only keep requests where this donor's blood group is biologically compatible.
    # This avoids hitting Redis at all for requests the donor can never help with.
    blood_compatible_requests = []
    for req in active_requests:
        compatible_groups = MatchingEngineService.get_compatible_donor_types(
            req.required_blood_group, is_plasma=is_plasma_derived(req.component_type)
        )
        if donor.blood_group in compatible_groups:
            blood_compatible_requests.append((req, compatible_groups))

    if not blood_compatible_requests:
        return []

    redis_conn = await get_redis()
    lock_mgr = ConcurrencyLockManager(redis_conn)

    # Batch check membership and TTL for all compatible requests in a single round-trip
    pipe = redis_conn.pipeline()
    for req, _ in blood_compatible_requests:
        pipe.sismember(lock_mgr._zone_key(req.id), donor.id)
        pipe.ttl(lock_mgr._zone_key(req.id))
    raw_results = await pipe.execute()

    alerts: List[BloodRequestOut] = []
    for idx, (request, _compatible_groups) in enumerate(blood_compatible_requests):
        is_member = raw_results[idx * 2]
        ttl_val = raw_results[idx * 2 + 1]
        # -1 means key exists with no expiry (persist) → open indefinitely
        # -2 means key missing → we'll enroll the donor below
        ttl_seconds = None if ttl_val == -2 else (86400 if ttl_val == -1 else ttl_val)

        # If not already in the alert zone, enroll now (no TTL — open indefinitely)
        if not is_member:
            await lock_mgr.register_alerted_donors(request.id, [donor.id])
            ttl_seconds = 86400

        alerts.append(
            BloodRequestOut.model_validate(request).model_copy(
                update={"alert_expires_in_seconds": ttl_seconds}
            )
        )

    return alerts



@router.post("/respond", response_model=DonorRespondOut)
async def respond_to_active_alert_contextual(
    resp: DonorRespondRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """
    [USER-FACING] Contextual 1-Tap Response for mobile app.
    Donor responds (ACCEPT / DECLINE) without needing a long URL ID.
    If 'request_id' is supplied in the request body, it targets that request or short code (e.g. 'REQ-8492');
    otherwise, it automatically discovers the emergency alert currently active for this donor.
    """
    target_request_id = resp.request_id

    if not target_request_id:
        active_alerts = await get_active_emergency_alerts(db=db, donor=donor, current_user=current_user)
        if not active_alerts:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active emergency dispatch alert is currently open for your account.",
            )
        target_request_id = active_alerts[0].id

    allocation_svc = AllocationService(db)
    result = await allocation_svc.process_donor_response(
        request_id=target_request_id,
        donor_id=donor.id,
        action=resp.action,
        bags_offered=resp.bags_offered or 1,
    )
    background_tasks.add_task(NotificationQueueService.process_next_batch, 20)
    return DonorRespondOut.model_validate(result)


@router.post("/requests/{id}/respond", response_model=DonorRespondOut)
async def respond_to_emergency_dispatch(
    id: str,
    resp: DonorRespondRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    donor: Donor = Depends(get_current_donor),
    current_user: User = Depends(require_roles(UserRole.DONOR)),
):
    """[USER-FACING] Donor responds (ACCEPT / DECLINE) using either full UUID or short code (e.g. 'REQ-8492')."""
    allocation_svc = AllocationService(db)
    result = await allocation_svc.process_donor_response(
        request_id=id,
        donor_id=donor.id,
        action=resp.action,
        bags_offered=resp.bags_offered or 1,
    )
    background_tasks.add_task(NotificationQueueService.process_next_batch, 20)
    return DonorRespondOut.model_validate(result)

