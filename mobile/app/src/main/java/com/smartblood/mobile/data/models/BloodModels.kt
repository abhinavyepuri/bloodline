package com.smartblood.mobile.data.models

import com.google.gson.annotations.SerializedName

data class DonorProfile(
    @SerializedName("id") val id: String,
    @SerializedName("user_id") val userId: String,
    @SerializedName("blood_group") val bloodGroup: String? = null,
    @SerializedName("blood_type") val bloodTypeField: String? = null,
    @SerializedName("date_of_birth") val dateOfBirth: String? = null,
    @SerializedName("weight_kg") val weightKg: Double? = null,
    @SerializedName("is_available") val isAvailable: Boolean = true,
    @SerializedName("reliability_score") val reliabilityScore: Double? = null,
    @SerializedName("total_successful_donations") val totalSuccessfulDonations: Int? = null,
    @SerializedName("last_donation_date") val lastDonationDate: String? = null,
    @SerializedName("latitude") val latitude: Double? = null,
    @SerializedName("longitude") val longitude: Double? = null,
    @SerializedName("location_updated_at") val locationUpdatedAt: String? = null
) {
    val bloodType: String get() = bloodGroup ?: bloodTypeField ?: "O-"
    val reliabilityPercentage: Int get() = ((reliabilityScore ?: 0.95) * 100).toInt()
    val donationsCount: Int get() = totalSuccessfulDonations ?: 0
}

data class BloodRequestItem(
    @SerializedName("id") val id: String,
    @SerializedName("code") val code: String? = null,
    @SerializedName("hospital_name") val hospitalNameField: String? = null,
    @SerializedName("hospital_address") val hospitalAddress: String? = null,
    @SerializedName("required_blood_group") val requiredBloodGroup: String? = null,
    @SerializedName("blood_type") val bloodTypeField: String? = null,
    @SerializedName("component_type") val componentType: String? = null,
    @SerializedName("units_requested") val unitsRequestedField: Int? = null,
    @SerializedName("units_required") val unitsRequiredField: Int? = null,
    @SerializedName("units_covered") val unitsCovered: Int = 0,
    @SerializedName("units_shortfall") val unitsShortfallField: Int? = null,
    @SerializedName("triage_level") val triageLevelField: String? = null,
    @SerializedName("urgency_level") val urgencyLevelField: String? = null,
    @SerializedName("calculated_urgency_score") val urgencyScoreField: Double? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("distance_km") val distanceKm: Double? = null,
    @SerializedName("created_at") val createdAt: String? = null
) {
    val hospitalName: String get() = hospitalNameField ?: "Emergency Medical Center"
    val bloodType: String get() = requiredBloodGroup ?: bloodTypeField ?: "O-"
    val unitsRequested: Int get() = unitsRequestedField ?: unitsRequiredField ?: 1
    val unitsShortfall: Int get() = unitsShortfallField ?: (unitsRequested - unitsCovered).coerceAtLeast(1)
    val urgencyScore: Int get() = (urgencyScoreField ?: 95.0).toInt()
    val urgencyLevel: String get() = triageLevelField ?: urgencyLevelField ?: "CRITICAL"
    val componentLabel: String get() = when (componentType) {
        "PRBC" -> "Packed Red Blood Cells"
        "PLATELETS" -> "Platelets"
        "FFP" -> "Fresh Frozen Plasma"
        "WHOLE_BLOOD" -> "Whole Blood"
        else -> componentType ?: "Red Blood Cells"
    }
}

data class AcceptDispatchPayload(
    @SerializedName("action") val action: String = "ACCEPT",
    @SerializedName("request_id") val requestId: String? = null,
    @SerializedName("bags_offered") val bagsOffered: Int? = 1
)

data class DonorRespondResult(
    @SerializedName("status") val status: String? = null,
    @SerializedName("allocation_id") val allocationId: String? = null,
    @SerializedName("donor_id") val donorId: String? = null,
    @SerializedName("slot") val slot: Int? = null,
    @SerializedName("distance_km") val distanceKm: Double? = null,
    @SerializedName("estimated_transit_minutes") val estimatedTransitMinutes: Double? = null,
    @SerializedName("units_covered") val unitsCovered: Int? = null,
    @SerializedName("units_requested") val unitsRequested: Int? = null,
    @SerializedName("shortfall") val shortfall: Int? = null,
    @SerializedName("request_status") val requestStatus: String? = null
)

data class DonorTelemetryOut(
    @SerializedName("donor_id") val donorId: String? = null,
    @SerializedName("latitude") val latitude: Double? = null,
    @SerializedName("longitude") val longitude: Double? = null,
    @SerializedName("active_allocation_id") val activeAllocationId: String? = null,
    @SerializedName("hospital_id") val hospitalId: String? = null,
    @SerializedName("hospital_name") val hospitalName: String? = null,
    @SerializedName("distance_to_hospital_km") val distanceToHospitalKm: Double? = null,
    @SerializedName("estimated_eta_minutes") val estimatedEtaMinutes: Int? = null,
    @SerializedName("is_approaching_ward") val isApproachingWard: Boolean = false,
    @SerializedName("message") val message: String? = null
)

data class DispatchNotification(
    @SerializedName("type") val type: String? = null,
    @SerializedName("request_id") val requestId: String = "",
    @SerializedName("urgency_score") val urgencyScore: Double? = null,
    @SerializedName("urgency") val urgencyField: String? = null,
    @SerializedName("triage_level") val triageLevel: String? = null,
    @SerializedName("required_blood_group") val requiredBloodGroup: String? = null,
    @SerializedName("blood_type") val bloodTypeField: String? = null,
    @SerializedName("hospital_name") val hospitalNameField: String? = null,
    @SerializedName("distance_km") val distanceKm: Double? = null,
    @SerializedName("ttl_seconds") val ttlSeconds: Int? = null,
    @SerializedName("message") val message: String? = null
) {
    val bloodType: String get() = requiredBloodGroup ?: bloodTypeField ?: "O-"
    val hospitalName: String get() = hospitalNameField ?: "Emergency Medical Center"
    val urgency: String get() = triageLevel ?: urgencyField ?: "CRITICAL"
}
