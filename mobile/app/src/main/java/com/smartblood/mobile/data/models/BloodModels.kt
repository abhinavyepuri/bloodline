package com.smartblood.mobile.data.models

import com.google.gson.annotations.SerializedName

data class DonorProfile(
    @SerializedName("id") val id: String,
    @SerializedName("user_id") val userId: String,
    @SerializedName("blood_group") val bloodGroup: String? = null,
    @SerializedName("blood_type") val bloodTypeField: String? = null,
    @SerializedName("is_available") val isAvailable: Boolean = true,
    @SerializedName("last_donation_date") val lastDonationDate: String? = null,
    @SerializedName("latitude") val latitude: Double? = null,
    @SerializedName("longitude") val longitude: Double? = null,
    @SerializedName("location_updated_at") val locationUpdatedAt: String? = null
) {
    val bloodType: String get() = bloodGroup ?: bloodTypeField ?: "O-"
}

data class BloodRequestItem(
    @SerializedName("id") val id: String,
    @SerializedName("hospital_name") val hospitalNameField: String? = null,
    @SerializedName("required_blood_group") val requiredBloodGroup: String? = null,
    @SerializedName("blood_type") val bloodTypeField: String? = null,
    @SerializedName("units_requested") val unitsRequestedField: Int? = null,
    @SerializedName("units_required") val unitsRequiredField: Int? = null,
    @SerializedName("triage_level") val triageLevelField: String? = null,
    @SerializedName("urgency_level") val urgencyLevelField: String? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("distance_km") val distanceKm: Double? = null,
    @SerializedName("created_at") val createdAt: String? = null
) {
    val hospitalName: String get() = hospitalNameField ?: "Emergency Medical Center"
    val bloodType: String get() = requiredBloodGroup ?: bloodTypeField ?: "O-"
    val unitsRequired: Int get() = unitsRequestedField ?: unitsRequiredField ?: 1
    val urgencyLevel: String get() = triageLevelField ?: urgencyLevelField ?: "CRITICAL"
}

data class AcceptDispatchPayload(
    @SerializedName("action") val action: String = "ACCEPT",
    @SerializedName("request_id") val requestId: String? = null
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
