package com.smartblood.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Warning
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
import com.smartblood.mobile.data.models.AcceptDispatchPayload
import com.smartblood.mobile.data.models.BloodRequestItem
import com.smartblood.mobile.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmergencyAlertScreen(
    requestId: String,
    onBack: () -> Unit,
    onAccepted: () -> Unit
) {
    var isSubmitting by remember { mutableStateOf(false) }
    var requestItem by remember { mutableStateOf<BloodRequestItem?>(null) }
    var bagsCount by remember { mutableStateOf(1) }
    var successMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    LaunchedEffect(requestId) {
        try {
            val resp = ApiClient.service.getActiveRequests()
            if (resp.isSuccessful) {
                val found = resp.body()?.find { it.id == requestId || it.code == requestId }
                requestItem = found
                if (found != null) {
                    bagsCount = 1
                }
            }
        } catch (_: Exception) {}
    }

    val maxBags = requestItem?.unitsShortfall ?: 2

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Emergency Dispatch Alert", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = TextPrimary)
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
                .verticalScroll(scrollState),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                // ── Alert Hero Card ─────────────────────────────────────────
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.5.dp, CrimsonRed, RoundedCornerShape(16.dp)),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                ) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = CrimsonDark,
                            modifier = Modifier.size(60.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.Warning,
                                    contentDescription = "Urgent Alert",
                                    tint = Color.White,
                                    modifier = Modifier.size(32.dp)
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        Text(
                            text = "CRITICAL BLOOD DISPATCH",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = CrimsonLight
                        )

                        Text(
                            text = requestItem?.hospitalName ?: "Emergency Trauma Ward",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )

                        Spacer(modifier = Modifier.height(14.dp))
                        HorizontalDivider(color = SurfaceCard)
                        Spacer(modifier = Modifier.height(14.dp))

                        // Match Blood Details
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceAround,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("Blood Group", fontSize = 11.sp, color = TextSecondary)
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = CrimsonRed,
                                    modifier = Modifier.padding(top = 4.dp)
                                ) {
                                    Text(
                                        text = requestItem?.bloodType ?: "O-",
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        color = Color.White,
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                                    )
                                }
                            }

                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("Urgency", fontSize = 11.sp, color = TextSecondary)
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = UrgentAmber.copy(alpha = 0.2f),
                                    modifier = Modifier.padding(top = 4.dp)
                                ) {
                                    Text(
                                        text = "${requestItem?.urgencyScore ?: 100}/100",
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = UrgentAmber,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                    )
                                }
                            }

                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("Shortfall", fontSize = 11.sp, color = TextSecondary)
                                Text(
                                    text = "${maxBags} bag(s)",
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = TextPrimary,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(14.dp))

                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.LocationOn, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(15.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = if (requestItem?.distanceKm != null) "Hospital is ~${String.format("%.1f", requestItem?.distanceKm)} km away" else "Hospital in your proximity zone",
                                fontSize = 12.sp,
                                color = TextSecondary
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // ── Bag Quantity Selector Card ──────────────────────────────
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                ) {
                    Column(modifier = Modifier.padding(18.dp)) {
                        Text(
                            text = "How many bags can you donate?",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            text = "Select up to $maxBags bag(s) needed by the hospital",
                            fontSize = 12.sp,
                            color = TextSecondary
                        )

                        Spacer(modifier = Modifier.height(14.dp))

                        // Stepper row
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            // Minus button
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (bagsCount > 1) SurfaceCard else DarkBackground,
                                modifier = Modifier
                                    .size(44.dp)
                                    .clickable(enabled = bagsCount > 1) {
                                        bagsCount = (bagsCount - 1).coerceAtLeast(1)
                                    }
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text("−", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = if (bagsCount > 1) TextPrimary else TextSecondary)
                                }
                            }

                            Spacer(modifier = Modifier.width(20.dp))

                            // Count display
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "$bagsCount",
                                    fontSize = 28.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = CrimsonRed
                                )
                                Text(
                                    text = if (bagsCount == 1) "bag" else "bags",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = TextSecondary
                                )
                            }

                            Spacer(modifier = Modifier.width(20.dp))

                            // Plus button
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (bagsCount < maxBags) SurfaceCard else DarkBackground,
                                modifier = Modifier
                                    .size(44.dp)
                                    .clickable(enabled = bagsCount < maxBags) {
                                        bagsCount = (bagsCount + 1).coerceAtMost(maxBags)
                                    }
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text("+", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = if (bagsCount < maxBags) TextPrimary else TextSecondary)
                                }
                            }
                        }

                        if (maxBags > 1) {
                            Spacer(modifier = Modifier.height(12.dp))
                            // Shortcut pills
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center
                            ) {
                                for (n in 1..maxBags) {
                                    val isSelected = bagsCount == n
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (isSelected) CrimsonDark else DarkBackground,
                                        modifier = Modifier
                                            .padding(horizontal = 4.dp)
                                            .clickable { bagsCount = n }
                                            .border(
                                                width = 1.dp,
                                                color = if (isSelected) CrimsonLight else SurfaceCard,
                                                shape = RoundedCornerShape(8.dp)
                                            )
                                    ) {
                                        Text(
                                            text = "$n",
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = if (isSelected) Color.White else TextSecondary,
                                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                successMessage?.let {
                    Spacer(modifier = Modifier.height(12.dp))
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = SuccessGreen.copy(alpha = 0.2f),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = SuccessGreen, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(text = it, color = SuccessGreen, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        }
                    }
                }

                errorMessage?.let {
                    Spacer(modifier = Modifier.height(12.dp))
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = CrimsonDark.copy(alpha = 0.3f),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(text = it, color = CrimsonLight, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // ── Action Buttons ──────────────────────────────────────────────
            Column(modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = {
                        isSubmitting = true
                        errorMessage = null
                        coroutineScope.launch {
                            try {
                                val resp = ApiClient.service.respondToRequestAlert(
                                    id = requestId,
                                    payload = AcceptDispatchPayload(
                                        action = "ACCEPT",
                                        requestId = requestId,
                                        bagsOffered = bagsCount
                                    )
                                )
                                if (resp.isSuccessful) {
                                    val result = resp.body()
                                    val bagsText = if (bagsCount > 1) "$bagsCount bags" else "1 bag"
                                    successMessage = "Committed $bagsText! Please head toward ${requestItem?.hospitalName ?: "the hospital"}."
                                    kotlinx.coroutines.delay(1200)
                                    onAccepted()
                                } else {
                                    errorMessage = "Could not accept request: ${resp.message()}"
                                }
                            } catch (e: Exception) {
                                errorMessage = "Error: ${e.localizedMessage ?: "Failed to connect to dispatch server"}"
                            } finally {
                                isSubmitting = false
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = CrimsonRed),
                    shape = RoundedCornerShape(12.dp),
                    enabled = !isSubmitting
                ) {
                    if (isSubmitting) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                    } else {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "CONFIRM & DONATE $bagsCount BAG${if (bagsCount > 1) "S" else ""}",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedButton(
                    onClick = {
                        isSubmitting = true
                        errorMessage = null
                        coroutineScope.launch {
                            try {
                                ApiClient.service.respondToRequestAlert(
                                    id = requestId,
                                    payload = AcceptDispatchPayload(
                                        action = "DECLINE",
                                        requestId = requestId
                                    )
                                )
                            } catch (_: Exception) {}
                            onBack()
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary),
                    enabled = !isSubmitting
                ) {
                    Icon(Icons.Default.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Decline / Cannot Make It", fontSize = 13.sp)
                }
            }
        }
    }
}
