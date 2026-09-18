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
    @GET("donors/profile")
    suspend fun getDonorProfile(): Response<DonorProfile>

    @PATCH("donors/availability")
    suspend fun updateAvailability(@Body body: Map<String, Boolean>): Response<DonorProfile>

    @POST("donors/location")
    suspend fun updateLocation(@Body location: Map<String, Double>): Response<Unit>

    // Active Emergency Requests & Responses
    @GET("requests/active")
    suspend fun getActiveRequests(): Response<List<BloodRequestItem>>

    @POST("requests/accept")
    suspend fun acceptEmergencyDispatch(@Body payload: AcceptDispatchPayload): Response<Map<String, Any>>
}
