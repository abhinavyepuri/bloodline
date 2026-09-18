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
                                // Start WebSocket client for real-time dispatch alerts
                                webSocketClient = BloodWebSocketClient(
                                    onNotificationReceived = { notification ->
                                        // Navigate to emergency alert if critical broadcast received
                                        navController.navigate("alert/${notification.requestId}")
                                    },
                                    onConnectionStateChanged = { /* handle connection state */ }
                                )
                                webSocketClient?.connect("mobile-donor-session")
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
