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
    suspend fun updateAvailability(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<DonorProfile>

    @POST("donors/me/telemetry")
    suspend fun updateLocation(@Body telemetry: Map<String, @JvmSuppressWildcards Any>): Response<DonorTelemetryOut>

    @POST("donors/me/heartbeat")
    suspend fun sendHeartbeat(@Body coordinates: Map<String, @JvmSuppressWildcards Any>): Response<DonorProfile>

    // Active Emergency Requests & Responses
    @GET("donors/requests/active")
    suspend fun getActiveRequests(): Response<List<BloodRequestItem>>

    @POST("donors/respond")
    suspend fun acceptEmergencyDispatch(@Body payload: AcceptDispatchPayload): Response<DonorRespondResult>

    @POST("donors/requests/{id}/respond")
    suspend fun respondToRequestAlert(@Path("id") id: String, @Body payload: AcceptDispatchPayload): Response<DonorRespondResult>
}
