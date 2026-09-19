package com.smartblood.mobile.data.api

import com.smartblood.mobile.data.models.*
import retrofit2.Response
import retrofit2.http.*

interface BloodBankApiService {

    // Auth endpoints
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    @GET("auth/me")
    suspend fun getCurrentUser(): Response<UserProfile>

    // Donor profile & availability endpoints
    @GET("donors/me")
    suspend fun getDonorProfile(): Response<DonorProfile>

    @PATCH("donors/availability")
    suspend fun updateAvailability(@Body body: Map<String, Boolean>): Response<DonorProfile>

    @POST("donors/me/telemetry")
    suspend fun updateLocation(@Body telemetry: Map<String, Double>): Response<Unit>

    @POST("donors/me/heartbeat")
    suspend fun sendHeartbeat(@Body coordinates: Map<String, Double>): Response<DonorProfile>

    // Active Emergency Requests & Responses
    @GET("donors/requests/active")
    suspend fun getActiveRequests(): Response<List<BloodRequestItem>>

    @POST("donors/respond")
    suspend fun acceptEmergencyDispatch(@Body payload: AcceptDispatchPayload): Response<Map<String, Any>>
}
