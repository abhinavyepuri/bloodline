package com.smartblood.mobile.data.websocket

import android.util.Log
import com.google.gson.Gson
import com.smartblood.mobile.data.api.ApiClient
import com.smartblood.mobile.data.models.DispatchNotification
import okhttp3.*
import java.util.concurrent.TimeUnit

class BloodWebSocketClient(
    private val onNotificationReceived: (DispatchNotification) -> Unit,
    private val onConnectionStateChanged: (Boolean) -> Unit
) {
    private val TAG = "BloodWebSocketClient"
    private var webSocket: WebSocket? = null
    private val gson = Gson()

    fun connect(token: String) {
        val requestUrl = "${ApiClient.WS_URL}?token=$token"
        val request = Request.Builder()
            .url(requestUrl)
            .build()

        val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket connected successfully to $requestUrl")
                onConnectionStateChanged(true)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "WebSocket message received: $text")
                try {
                    val notification = gson.fromJson(text, DispatchNotification::class.java)
                    if (notification != null) {
                        onNotificationReceived(notification)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing WebSocket event JSON: ${e.message}")
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WebSocket closed: $reason (code: $code)")
                onConnectionStateChanged(false)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket error: ${t.message}")
                onConnectionStateChanged(false)
            }
        })
    }

    fun sendAck(requestId: String, donorId: String) {
        val payload = mapOf(
            "action" to "ACK_ALERT",
            "request_id" to requestId,
            "donor_id" to donorId,
            "timestamp" to System.currentTimeMillis()
        )
        val json = gson.toJson(payload)
        webSocket?.send(json)
    }

    fun disconnect() {
        webSocket?.close(1000, "Normal closure")
        webSocket = null
    }
}
