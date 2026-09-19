package com.smartblood.mobile.data.workers

import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.util.Log
import androidx.work.*
import com.smartblood.mobile.data.api.ApiClient
import java.util.concurrent.TimeUnit

/**
 * Periodic background worker that sends lightweight location heartbeats to the backend.
 * Keeps the donor's PostGIS spatial coordinates and location_updated_at timestamp fresh,
 * ensuring they are eligible for real-time emergency broadcasts without battery drain.
 */
class LocationHeartbeatWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val token = ApiClient.getAuthToken()
        if (token.isNullOrBlank()) {
            Log.d(TAG, "No auth token present, skipping heartbeat.")
            return Result.success()
        }

        try {
            val location = getLastKnownLocation(applicationContext)
            if (location != null) {
                val payload = mapOf(
                    "latitude" to location.latitude,
                    "longitude" to location.longitude
                )
                val response = ApiClient.service.sendHeartbeat(payload)
                if (response.isSuccessful) {
                    Log.i(TAG, "Location heartbeat sent successfully: ${location.latitude}, ${location.longitude}")
                } else {
                    Log.w(TAG, "Heartbeat failed with code: ${response.code()}")
                }
            } else {
                Log.d(TAG, "Unable to acquire current location fix.")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception during location heartbeat: ${e.message}", e)
            return Result.retry()
        }

        return Result.success()
    }

    private fun getLastKnownLocation(context: Context): Location? {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return null

        return try {
            val gpsLocation = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            val networkLocation = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            val passiveLocation = locationManager.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)

            listOfNotNull(gpsLocation, networkLocation, passiveLocation)
                .maxByOrNull { it.time }
        } catch (e: SecurityException) {
            Log.w(TAG, "Location permissions not granted: ${e.message}")
            null
        }
    }

    companion object {
        private const val TAG = "LocationHeartbeat"
        private const val UNIQUE_WORK_NAME = "SmartBlood_LocationHeartbeat"

        /**
         * Enqueues a periodic heartbeat worker running every 15 minutes while connected to network.
         */
        fun startPeriodicHeartbeat(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<LocationHeartbeatWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
            Log.i(TAG, "Periodic location heartbeat worker scheduled (15 min interval).")
        }

        /**
         * Cancels periodic background heartbeats (e.g. when donor logs out or toggles unavailable).
         */
        fun cancelPeriodicHeartbeat(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
            Log.i(TAG, "Periodic location heartbeat worker cancelled.")
        }
    }
}
