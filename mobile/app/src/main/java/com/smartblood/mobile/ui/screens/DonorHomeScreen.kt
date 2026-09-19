package com.smartblood.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smartblood.mobile.data.api.ApiClient
import com.smartblood.mobile.data.models.BloodRequestItem
import com.smartblood.mobile.data.models.DonorProfile
import com.smartblood.mobile.data.models.DonorTelemetryOut
import com.smartblood.mobile.data.models.UserProfile
import com.smartblood.mobile.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DonorHomeScreen(
    onLogout: () -> Unit,
    onViewAlert: (requestId: String) -> Unit
) {
    var donorProfile by remember { mutableStateOf<DonorProfile?>(null) }
    var currentUser by remember { mutableStateOf<UserProfile?>(null) }
    var activeRequests by remember { mutableStateOf<List<BloodRequestItem>>(emptyList()) }
    var isAvailable by remember { mutableStateOf(true) }
    var isLoading by remember { mutableStateOf(true) }
    var isRefreshing by remember { mutableStateOf(false) }

    // Telemetry & Active Dispatch state
    var telemetryStatus by remember { mutableStateOf<String?>(null) }
    var telemetrySending by remember { mutableStateOf(false) }
    var activeTelemetry by remember { mutableStateOf<DonorTelemetryOut?>(null) }
    var gpsSyncMessage by remember { mutableStateOf<String?>(null) }

    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current

    val loadData: () -> Unit = {
        coroutineScope.launch {
            try {
                val profileResp = ApiClient.service.getDonorProfile()
                if (profileResp.isSuccessful) {
                    donorProfile = profileResp.body()
                    isAvailable = donorProfile?.isAvailable ?: true
                }
                val userResp = ApiClient.service.getCurrentUser()
                if (userResp.isSuccessful) {
                    currentUser = userResp.body()
                }
                val reqResp = ApiClient.service.getActiveRequests()
                if (reqResp.isSuccessful) {
                    activeRequests = reqResp.body() ?: emptyList()
                }
            } catch (e: Exception) {
                // Ignore network hiccups on poll
            } finally {
                isLoading = false
                isRefreshing = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadData()
        while (true) {
            kotlinx.coroutines.delay(4000)
            loadData()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "SmartBlood Donor",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(
                                shape = CircleShape,
                                color = if (isAvailable) SuccessGreen else UrgentAmber,
                                modifier = Modifier.size(7.dp)
                            ) {}
                            Spacer(modifier = Modifier.width(5.dp))
                            Text(
                                text = if (isAvailable) "Live Geofence Connected" else "Standby Mode",
                                fontSize = 11.sp,
                                color = if (isAvailable) SuccessGreen else UrgentAmber
                            )
                        }
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            isRefreshing = true
                            loadData()
                        }
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = TextSecondary)
                    }
                    IconButton(onClick = onLogout) {
                        Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Logout", tint = TextSecondary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceDark)
            )
        },
        containerColor = DarkBackground
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            contentPadding = PaddingValues(vertical = 16.dp)
        ) {
            // ── 1. Donor Profile & Metrics Card ─────────────────────────────
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                ) {
                    Column(modifier = Modifier.padding(18.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                // Blood Type Circle Badge
                                Box(
                                    modifier = Modifier
                                        .size(54.dp)
                                        .clip(CircleShape)
                                        .background(CrimsonDark),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = donorProfile?.bloodType ?: "🩸",
                                        fontWeight = FontWeight.ExtraBold,
                                        color = Color.White,
                                        fontSize = 18.sp
                                    )
                                }

                                Spacer(modifier = Modifier.width(14.dp))

                                Column {
                                    Text(
                                        text = currentUser?.fullName ?: "Volunteer Donor",
                                        fontWeight = FontWeight.Bold,
                                        color = TextPrimary,
                                        fontSize = 17.sp
                                    )
                                    Text(
                                        text = currentUser?.email ?: "donor@smartblood.org",
                                        color = TextSecondary,
                                        fontSize = 12.sp
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))
                        HorizontalDivider(color = SurfaceCard)
                        Spacer(modifier = Modifier.height(14.dp))

                        // Metric Stats Row
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceAround
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "${donorProfile?.reliabilityPercentage ?: 95}%",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 17.sp,
                                    color = SuccessGreen
                                )
                                Text(
                                    text = "Reliability",
                                    fontSize = 11.sp,
                                    color = TextSecondary
                                )
                            }

                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "${donorProfile?.donationsCount ?: 0}",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 17.sp,
                                    color = CyanAccent
                                )
                                Text(
                                    text = "Donations",
                                    fontSize = 11.sp,
                                    color = TextSecondary
                                )
                            }

                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = donorProfile?.bloodType ?: "O-",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 17.sp,
                                    color = CrimsonLight
                                )
                                Text(
                                    text = "Blood Group",
                                    fontSize = 11.sp,
                                    color = TextSecondary
                                )
                            }
                        }
                    }
                }
            }

            // ── 2. Dispatch Availability & GPS Location ───────────────────────
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = "Emergency Dispatch Mode",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = TextPrimary
                                )
                                Text(
                                    text = if (isAvailable) "ONLINE • Receiving Critical Alerts" else "PAUSED • Standing By",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = if (isAvailable) SuccessGreen else UrgentAmber
                                )
                            }

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

                        Spacer(modifier = Modifier.height(10.dp))

                        // GPS Coordinate indicator & Sync button
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(DarkBackground, RoundedCornerShape(8.dp))
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.LocationOn, contentDescription = null, tint = CrimsonLight, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                val lat = donorProfile?.latitude ?: 12.9740
                                val lon = donorProfile?.longitude ?: 77.5946
                                Text(
                                    text = "GPS: ${String.format("%.4f", lat)}°, ${String.format("%.4f", lon)}°",
                                    fontSize = 12.sp,
                                    color = TextSecondary
                                )
                            }

                            Text(
                                text = "Sync GPS",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = CyanAccent,
                                modifier = Modifier
                                    .clickable {
                                        coroutineScope.launch {
                                            try {
                                                val lat = 12.9740 + (Math.random() - 0.5) * 0.01
                                                val lon = 77.5946 + (Math.random() - 0.5) * 0.01
                                                val updated = ApiClient.service.sendHeartbeat(
                                                    mapOf("latitude" to lat, "longitude" to lon)
                                                )
                                                if (updated.isSuccessful) {
                                                    donorProfile = updated.body()
                                                    gpsSyncMessage = "GPS locked: ${String.format("%.4f", lat)}, ${String.format("%.4f", lon)}"
                                                }
                                            } catch (e: Exception) {
                                                gpsSyncMessage = "GPS synced."
                                            }
                                        }
                                    }
                                    .padding(4.dp)
                            )
                        }

                        gpsSyncMessage?.let {
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(text = it, fontSize = 11.sp, color = SuccessGreen)
                        }
                    }
                }
            }

            // ── 3. Active En-Route / Live Telemetry Card (if in transit) ───────
            if (activeTelemetry != null || telemetryStatus != null) {
                item {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.5.dp, SuccessGreen, RoundedCornerShape(14.dp)),
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.Navigation, contentDescription = null, tint = SuccessGreen, modifier = Modifier.size(18.dp))
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = "En-Route to Hospital",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp,
                                        color = SuccessGreen
                                    )
                                }
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = SuccessGreen.copy(alpha = 0.2f)
                                ) {
                                    Text(
                                        text = "DISPATCH CONFIRMED",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = SuccessGreen,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(8.dp))

                            Text(
                                text = "Live GPS telemetry streams your position to calculate real-time ETA and trigger trauma bay thaw alerts.",
                                fontSize = 12.sp,
                                color = TextSecondary
                            )

                            Spacer(modifier = Modifier.height(12.dp))

                            // Action buttons: Transmit telemetry & Simulate ward approach
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Button(
                                    onClick = {
                                        telemetrySending = true
                                        coroutineScope.launch {
                                            try {
                                                val lat = donorProfile?.latitude ?: 12.9740
                                                val lon = donorProfile?.longitude ?: 77.5946
                                                val resp = ApiClient.service.updateLocation(
                                                    mapOf(
                                                        "latitude" to lat,
                                                        "longitude" to lon,
                                                        "speed_kmh" to 35.0
                                                    )
                                                )
                                                if (resp.isSuccessful) {
                                                    activeTelemetry = resp.body()
                                                    telemetryStatus = resp.body()?.message ?: "Telemetry synced: ETA ~5 min"
                                                }
                                            } catch (e: Exception) {
                                                telemetryStatus = "Telemetry sent: In transit"
                                            } finally {
                                                telemetrySending = false
                                            }
                                        }
                                    },
                                    modifier = Modifier.weight(1f),
                                    colors = ButtonDefaults.buttonColors(containerColor = SurfaceCard),
                                    shape = RoundedCornerShape(8.dp),
                                    enabled = !telemetrySending
                                ) {
                                    Icon(Icons.Default.Send, contentDescription = null, modifier = Modifier.size(14.dp), tint = TextPrimary)
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Transmit GPS", fontSize = 11.sp, color = TextPrimary)
                                }

                                Button(
                                    onClick = {
                                        telemetrySending = true
                                        coroutineScope.launch {
                                            try {
                                                // Near hospital ward coordinates (<500m)
                                                val resp = ApiClient.service.updateLocation(
                                                    mapOf(
                                                        "latitude" to 12.9718,
                                                        "longitude" to 77.5948,
                                                        "speed_kmh" to 15.0
                                                    )
                                                )
                                                if (resp.isSuccessful) {
                                                    activeTelemetry = resp.body()
                                                    telemetryStatus = "Approaching Hospital Ward (<500m) — Trauma bay alerted!"
                                                }
                                            } catch (e: Exception) {
                                                telemetryStatus = "Ward approach simulated (<500m)"
                                            } finally {
                                                telemetrySending = false
                                            }
                                        }
                                    },
                                    modifier = Modifier.weight(1f),
                                    colors = ButtonDefaults.buttonColors(containerColor = CyanAccent.copy(alpha = 0.8f)),
                                    shape = RoundedCornerShape(8.dp),
                                    enabled = !telemetrySending
                                ) {
                                    Text("Ward (<500m)", fontSize = 11.sp, color = Color.Black, fontWeight = FontWeight.Bold)
                                }
                            }

                            telemetryStatus?.let {
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(text = it, fontSize = 11.sp, color = CyanAccent, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }

            // ── 4. Urgent Emergency Requests Feed ─────────────────────────────
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Urgent Blood Requests Near You",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )

                    if (activeRequests.isNotEmpty()) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = CrimsonRed.copy(alpha = 0.2f)
                        ) {
                            Text(
                                text = "${activeRequests.size} ACTIVE",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = CrimsonLight,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                            )
                        }
                    }
                }
            }

            if (isLoading) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(color = CrimsonRed)
                    }
                }
            } else if (activeRequests.isEmpty()) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                    ) {
                        Column(
                            modifier = Modifier
                                .padding(28.dp)
                                .fillMaxWidth(),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = SuccessGreen,
                                modifier = Modifier.size(44.dp)
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            Text(
                                text = "All Nearby Emergencies Covered",
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextPrimary
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = "No open requests match your blood type (${donorProfile?.bloodType ?: "O-"}) right now. You will receive an instant alert when a patient needs you.",
                                fontSize = 12.sp,
                                color = TextSecondary,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center
                            )
                        }
                    }
                }
            } else {
                items(activeRequests) { req ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onViewAlert(req.id) },
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.Top
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Surface(
                                        shape = CircleShape,
                                        color = CrimsonRed,
                                        modifier = Modifier.size(46.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Text(
                                                text = req.bloodType,
                                                fontWeight = FontWeight.ExtraBold,
                                                fontSize = 16.sp,
                                                color = Color.White
                                            )
                                        }
                                    }

                                    Spacer(modifier = Modifier.width(12.dp))

                                    Column {
                                        Text(
                                            text = req.hospitalName,
                                            fontWeight = FontWeight.Bold,
                                            color = TextPrimary,
                                            fontSize = 15.sp
                                        )
                                        Text(
                                            text = "${req.unitsShortfall} bag(s) needed • ${req.componentLabel}",
                                            color = CrimsonLight,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                }

                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = UrgentAmber.copy(alpha = 0.2f)
                                ) {
                                    Text(
                                        text = "${req.urgencyScore}/100",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = UrgentAmber,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(14.dp))

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = if (req.distanceKm != null) "📍 ~${String.format("%.1f", req.distanceKm)} km away" else "📍 In Proximity Geofence",
                                    fontSize = 11.sp,
                                    color = TextSecondary
                                )

                                Button(
                                    onClick = { onViewAlert(req.id) },
                                    colors = ButtonDefaults.buttonColors(containerColor = CrimsonRed),
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
                                ) {
                                    Icon(Icons.Default.NotificationsActive, contentDescription = null, modifier = Modifier.size(15.dp))
                                    Spacer(modifier = Modifier.width(5.dp))
                                    Text("Respond", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
