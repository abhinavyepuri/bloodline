package com.smartblood.mobile.data.api

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {

    /**
     * Default base URL points to FastAPI backend on local machine from Android Emulator.
     * Use 10.0.2.2 for Android Emulator, or your local machine's IP for physical devices.
     */
    var BASE_URL: String = "http://10.0.2.2:8000/api/v1/"
    var WS_URL: String = "ws://10.0.2.2:8000/api/v1/realtime/ws"

    private var authToken: String? = null
    private var retrofitInstance: Retrofit? = null

    fun setServerHost(hostAndPort: String) {
        val clean = hostAndPort.trim()
            .removePrefix("http://")
            .removePrefix("https://")
            .removePrefix("ws://")
            .removePrefix("wss://")
            .removeSuffix("/")
        val hostWithPort = if (clean.contains(":")) clean else "$clean:8000"
        BASE_URL = "http://$hostWithPort/api/v1/"
        WS_URL = "ws://$hostWithPort/api/v1/realtime/ws"
        retrofitInstance = null
    }

    fun setAuthToken(token: String?) {
        authToken = token
    }

    fun getAuthToken(): String? = authToken

    private val authInterceptor = Interceptor { chain ->
        val original = chain.request()
        val builder = original.newBuilder()
        authToken?.let { token ->
            builder.header("Authorization", "Bearer $token")
        }
        builder.header("Content-Type", "application/json")
        chain.proceed(builder.build())
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    val service: BloodBankApiService
        get() {
            var instance = retrofitInstance
            if (instance == null) {
                instance = Retrofit.Builder()
                    .baseUrl(BASE_URL)
                    .client(okHttpClient)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()
                retrofitInstance = instance
            }
            return instance.create(BloodBankApiService::class.java)
        }
}
