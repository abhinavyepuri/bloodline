export type UserRole = 'HOSPITAL' | 'BLOOD_BANK' | 'DONOR' | 'COORDINATOR' | 'ADMIN';

export type TriageLevel =
  | 'MASSIVE_TRANSFUSION_PROTOCOL'
  | 'ACTIVE_TRAUMA'
  | 'SCHEDULED_EMERGENCY_RESERVE'
  | 'ROUTINE_CLINICAL';

export type RequestStatus =
  | 'PENDING_EVALUATION'
  | 'PROXIMITY_ZONE_NOTIFIED'
  | 'COMMITTED_IN_TRANSIT'
  | 'RE_PLANNING'
  | 'FULFILLED'
  | 'CANCELLED'
  | 'EXPIRED';

export type BloodComponentType =
  | 'WHOLE_BLOOD'
  | 'PRBC'
  | 'PLATELETS'
  | 'FFP'
  | 'CRYOPRECIPITATE';

export type UnitStatus =
  | 'AVAILABLE'
  | 'LOCKED_RESERVE'
  | 'DISPATCHED'
  | 'TRANSFUSED'
  | 'EXPIRED'
  | 'QUARANTINED';

export type AllocationSourceType = 'BLOOD_BANK_INVENTORY' | 'LIVE_DONOR';

export type AllocationStatus =
  | 'SOFT_LOCKED'
  | 'HARD_LOCKED'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'CANCELLED_BY_DONOR'
  | 'TIMED_OUT'
  | 'RE_OPTIMIZED';

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone_number: string;
  role: UserRole;
  is_active?: boolean;
  is_verified: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Allocation {
  id: string;
  request_id: string;
  source_type: AllocationSourceType;
  inventory_unit_id?: string;
  donor_id?: string;
  batch_number?: string;
  blood_group?: string;
  status: AllocationStatus;
  estimated_transit_minutes?: number;
  distance_km?: number;
  allocated_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface BloodRequest {
  id: string;
  code?: string;
  hospital_id: string;
  hospital_name?: string;
  hospital_address?: string;
  patient_id_token: string;
  required_blood_group: string;
  component_type: BloodComponentType;
  units_requested: number;
  units_covered: number;
  units_shortfall: number;
  triage_level: TriageLevel;
  calculated_urgency_score: number;
  deadline_at: string;
  status: RequestStatus;
  created_at: string;
  allocations?: Allocation[];
  /**
   * Seconds left for a donor to respond, relative to when the alert feed was fetched.
   * Only the donor-facing alert feed (`GET /donors/requests/active`) populates this;
   * it is absent everywhere else, so callers must fall back to their own window.
   */
  alert_expires_in_seconds?: number;
}

export interface InventoryUnit {
  id: string;
  blood_bank_id: string;
  batch_number: string;
  blood_group: string;
  component_type: BloodComponentType;
  volume_ml: number;
  collection_date: string;
  expiry_date: string;
  status: UnitStatus;
  lock_expires_at?: string;
  created_at: string;
}

export type HealthEligibilityStatus = 'ELIGIBLE' | 'TEMPORARILY_DEFERRED' | 'PERMANENTLY_DEFERRED';

export interface DonorHealthReport {
  id: string;
  donor_id: string;
  report_code: string;
  hemoglobin_g_dl: number;
  systolic_bp: number;
  diastolic_bp: number;
  pulse_bpm: number;
  temperature_c: number;
  weight_kg: number;
  blood_glucose_mg_dl?: number;
  hiv_status: string;
  hepb_status: string;
  hepc_status: string;
  syphilis_status: string;
  malaria_status: string;
  eligibility_status: HealthEligibilityStatus;
  deferral_reason?: string;
  deferral_end_date?: string;
  doctor_name?: string;
  facility_name?: string;
  doctor_remarks?: string;
  created_at: string;
}

export interface Donor {
  id: string;
  user_id: string;
  blood_group: string;
  date_of_birth: string;
  weight_kg: number;
  last_donation_date?: string;
  is_available: boolean;
  reliability_score: number;
  total_successful_donations: number;
  latitude?: number;
  longitude?: number;
  location_updated_at?: string;
  latest_health_report?: DonorHealthReport;
  created_at: string;
}

/**
 * Reduced donor shape returned by cross-tenant listings (GET /donors).
 * The server omits date of birth, weight, coordinates and user_id from these.
 */
export interface DonorPublic {
  id: string;
  blood_group: string;
  is_available: boolean;
  reliability_score: number;
  total_successful_donations: number;
  last_donation_date?: string;
}

export interface HospitalDirectoryEntry {
  id: string;
  name: string;
  address: string;
  is_accredited: boolean;
  latitude: number;
  longitude: number;
}

/** Response body for POST /donors/me/telemetry. */
export interface DonorTelemetry {
  donor_id: string;
  latitude: number;
  longitude: number;
  active_allocation_id?: string;
  hospital_id?: string;
  hospital_name?: string;
  distance_to_hospital_km?: number;
  estimated_eta_minutes?: number;
  is_approaching_ward?: boolean;
  message?: string;
  /** Compatibility aliases also emitted by the API. */
  distance_km?: number;
  estimated_transit_minutes?: number;
  geofence_triggered?: boolean;
}

/** Response body for a donor accepting or declining an alert. */
export interface DonorRespondResult {
  status: string;
  allocation_id?: string;
  allocation_ids?: string[];
  donor_id?: string;
  slot?: number;
  distance_km?: number;
  estimated_transit_minutes?: number;
  bags_committed?: number;
  units_covered?: number;
  units_requested?: number;
  shortfall?: number;
  /**
   * Status of the request itself after this response, as opposed to `status`, which
   * describes the outcome of the response ("ALREADY_CLAIMED", "DECLINED", ...).
   */
  request_status?: RequestStatus;
}

export interface AllocationAuditLog {
  id: string;
  request_id: string;
  allocation_id?: string;
  decision_type: string;
  urgency_score: number;
  candidate_scores_json: Record<string, any>;
  selected_resource_id: string;
  rationale_summary: string;
  created_at: string;
}

export interface WebSocketEvent {
  type: string;
  [key: string]: any;
}

export interface AdminOverview {
  active_requests_count: number;
  available_inventory_units_count: number;
  active_donors_count: number;
  recent_allocations_count: number;
  system_status: string;
}

export interface AdminMetrics {
  mean_time_to_secure_seconds: number;
  donor_acceptance_conversion_rate: number;
  replan_rate: number;
  total_requests_processed: number;
  average_transit_distance_km: number;
}
