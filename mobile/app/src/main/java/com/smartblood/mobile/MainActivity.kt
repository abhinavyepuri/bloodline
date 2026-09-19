package com.smartblood.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import com.smartblood.mobile.data.api.ApiClient
import com.smartblood.mobile.data.websocket.BloodWebSocketClient
import com.smartblood.mobile.ui.screens.*
import com.smartblood.mobile.ui.theme.SmartBloodTheme

class MainActivity : ComponentActivity() {

    private var webSocketClient: BloodWebSocketClient? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            SmartBloodTheme {
                val navController = rememberNavController()

                NavHost(
                    navController = navController,
                    startDestination = "login"
                ) {
                    composable("login") {
                        LoginScreen(
                            onLoginSuccess = { token, role ->
                                // Start background periodic location heartbeat
                                com.smartblood.mobile.data.workers.LocationHeartbeatWorker.startPeriodicHeartbeat(this@MainActivity)

                                // Start WebSocket client for real-time dispatch alerts
                                webSocketClient = BloodWebSocketClient(
                                    onNotificationReceived = { notification ->
                                        if (notification.type == "EMERGENCY_DISPATCH_ALERT" && notification.requestId.isNotBlank()) {
                                            runOnUiThread {
                                                try {
                                                    navController.navigate("alert/${notification.requestId}")
                                                } catch (e: Exception) {
                                                    android.util.Log.e("MainActivity", "Navigation to alert failed: ${e.message}")
                                                }
                                            }
                                        }
                                    },
                                    onConnectionStateChanged = { /* handle connection state */ }
                                )
                                webSocketClient?.connect(token)
                                navController.navigate("donor_home") {
                                    popUpTo("login") { inclusive = true }
                                }
                            }
                        )
                    }

                    composable("donor_home") {
                        DonorHomeScreen(
                            onLogout = {
                                ApiClient.setAuthToken(null)
                                webSocketClient?.disconnect()
                                com.smartblood.mobile.data.workers.LocationHeartbeatWorker.cancelPeriodicHeartbeat(this@MainActivity)
                                navController.navigate("login") {
                                    popUpTo("donor_home") { inclusive = true }
                                }
                            },
                            onViewAlert = { requestId ->
                                navController.navigate("alert/$requestId")
                            }
                        )
                    }

                    composable(
                        route = "alert/{requestId}",
                        arguments = listOf(navArgument("requestId") { type = NavType.StringType })
                    ) { backStackEntry ->
                        val requestId = backStackEntry.arguments?.getString("requestId") ?: "0"
                        EmergencyAlertScreen(
                            requestId = requestId,
                            onBack = { navController.popBackStack() },
                            onAccepted = { navController.popBackStack() }
                        )
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        webSocketClient?.disconnect()
    }
}
