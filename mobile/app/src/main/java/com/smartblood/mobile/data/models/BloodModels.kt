package com.smartblood.mobile.data.models

import com.google.gson.annotations.SerializedName

data class DonorProfile(
    @SerializedName("id") val id: String,
    @SerializedName("user_id") val userId: String,
    @SerializedName("blood_type") val bloodType: String,
    @SerializedName("rh_factor") val rhFactor: String,
    @SerializedName("is_available") val isAvailable: Boolean,
    @SerializedName("last_donation_date") val lastDonationDate: String?,
    @SerializedName("current_latitude") val latitude: Double?,
    @SerializedName("current_longitude") val longitude: Double?
)

data class BloodRequestItem(
    @SerializedName("id") val id: String,
    @SerializedName("hospital_name") val hospitalName: String,
    @SerializedName("blood_type") val bloodType: String,
    @SerializedName("units_required") val unitsRequired: Int,
    @SerializedName("urgency_level") val urgencyLevel: String, // CRITICAL, URGENT, ROUTINE
    @SerializedName("status") val status: String,
    @SerializedName("distance_km") val distanceKm: Double?,
    @SerializedName("created_at") val createdAt: String
)

data class AcceptDispatchPayload(
    @SerializedName("request_id") val requestId: String,
    @SerializedName("donor_id") val donorId: String,
    @SerializedName("latitude") val latitude: Double,
    @SerializedName("longitude") val longitude: Double
)

data class DispatchNotification(
    @SerializedName("type") val type: String, // "DISPATCH_ALERT"
    @SerializedName("request_id") val requestId: String,
    @SerializedName("urgency") val urgency: String,
    @SerializedName("blood_type") val bloodType: String,
    @SerializedName("hospital_name") val hospitalName: String,
    @SerializedName("distance_km") val distanceKm: Double,
    @SerializedName("ttl_seconds") val ttlSeconds: Int
)
