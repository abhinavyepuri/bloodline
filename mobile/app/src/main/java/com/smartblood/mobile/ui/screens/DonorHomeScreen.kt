package com.smartblood.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smartblood.mobile.data.api.ApiClient
import com.smartblood.mobile.data.models.BloodRequestItem
import com.smartblood.mobile.data.models.DonorProfile
import com.smartblood.mobile.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DonorHomeScreen(
    onLogout: () -> Unit,
    onViewAlert: (requestId: String) -> Unit
) {
    var donorProfile by remember { mutableStateOf<DonorProfile?>(null) }
    var activeRequests by remember { mutableStateOf<List<BloodRequestItem>>(emptyList()) }
    var isAvailable by remember { mutableStateOf(true) }
    var isLoading by remember { mutableStateOf(true) }
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        try {
            val reqResp = ApiClient.service.getActiveRequests()
            if (reqResp.isSuccessful) {
                activeRequests = reqResp.body() ?: emptyList()
            }
            val profileResp = ApiClient.service.getDonorProfile()
            if (profileResp.isSuccessful) {
                donorProfile = profileResp.body()
                isAvailable = donorProfile?.isAvailable ?: true
            }
        } catch (_: Exception) {
            // Fallback for mock preview
        } finally {
            isLoading = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Donor Dashboard", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
                        Text("Live Geofence Connected", fontSize = 11.sp, color = SuccessGreen)
                    }
                },
                actions = {
                    IconButton(onClick = onLogout) {
                        Icon(Icons.Default.ExitToApp, contentDescription = "Logout", tint = TextSecondary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceDark)
            )
        },
        containerColor = DarkBackground
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            // Status & Availability Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Emergency Dispatch Status", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = TextSecondary)
                        Text(
                            text = if (isAvailable) "READY FOR DISPATCH" else "OFFLINE / STANDBY",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (isAvailable) SuccessGreen else UrgentAmber
                        )
                    }
                    val context = androidx.compose.ui.platform.LocalContext.current
                    Switch(
                        checked = isAvailable,
                        onCheckedChange = { checked ->
                            isAvailable = checked
                            if (checked) {
                                com.smartblood.mobile.data.workers.LocationHeartbeatWorker.startPeriodicHeartbeat(context)
                            } else {
                                com.smartblood.mobile.data.workers.LocationHeartbeatWorker.cancelPeriodicHeartbeat(context)
                            }
                            coroutineScope.launch {
                                try {
                                    ApiClient.service.updateAvailability(mapOf("is_available" to checked))
                                } catch (_: Exception) {}
                            }
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = CrimsonRed,
                            checkedTrackColor = CrimsonDark
                        )
                    )
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = "Active Emergency Requests",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            )

            Spacer(modifier = Modifier.height(10.dp))

            if (isLoading) {
                Box(modifier = Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = CrimsonRed)
                }
            } else if (activeRequests.isEmpty()) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp).fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(Icons.Default.LocationOn, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(36.dp))
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("No active emergency alerts in your proximity", fontSize = 13.sp, color = TextSecondary)
                    }
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(activeRequests) { req ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                            colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                        ) {
                            Row(
                                modifier = Modifier.padding(14.dp).fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(42.dp)
                                            .clip(CircleShape)
                                            .background(CrimsonDark),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(req.bloodType, fontWeight = FontWeight.Bold, color = TextPrimary)
                                    }
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Column {
                                        Text(req.hospitalName, fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 14.sp)
                                        Text("${req.unitsRequired} Units • ${req.urgencyLevel}", color = UrgentAmber, fontSize = 12.sp)
                                    }
                                }

                                Button(
                                    onClick = { onViewAlert(req.id) },
                                    colors = ButtonDefaults.buttonColors(containerColor = CrimsonRed),
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                                ) {
                                    Icon(Icons.Default.NotificationsActive, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Respond", fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
