package com.smartblood.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smartblood.mobile.data.api.ApiClient
import com.smartblood.mobile.data.models.AcceptDispatchPayload
import com.smartblood.mobile.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmergencyAlertScreen(
    requestId: String,
    onBack: () -> Unit,
    onAccepted: () -> Unit
) {
    var isAccepting by remember { mutableStateOf(false) }
    var successMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Emergency Dispatch Alert", fontSize = 18.sp, color = TextPrimary) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = TextPrimary)
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
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark)
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = "Urgent Alert",
                        tint = CrimsonRed,
                        modifier = Modifier.size(64.dp)
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = "CRITICAL BLOOD DISPATCH",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = CrimsonLight
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = "Request ID: $requestId",
                        fontSize = 12.sp,
                        color = TextSecondary
                    )

                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider(color = SurfaceCard)
                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = "A critical blood unit request has matched your blood type and proximity. First responder to confirm locks the allocation.",
                        fontSize = 14.sp,
                        color = TextPrimary
                    )

                    successMessage?.let {
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(text = it, color = SuccessGreen, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    }

                    errorMessage?.let {
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(text = it, color = CrimsonLight, fontSize = 13.sp)
                    }
                }
            }

            Column(modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = {
                        isAccepting = true
                        errorMessage = null
                        coroutineScope.launch {
                            try {
                                val resp = ApiClient.service.acceptEmergencyDispatch(
                                    AcceptDispatchPayload(
                                        action = "ACCEPT",
                                        requestId = requestId
                                    )
                                )
                                if (resp.isSuccessful) {
                                    successMessage = "Dispatch accepted! Route locked."
                                    onAccepted()
                                } else {
                                    errorMessage = "Could not lock request: ${resp.message()}"
                                }
                            } catch (e: Exception) {
                                errorMessage = "Error: ${e.localizedMessage}"
                            } finally {
                                isAccepting = false
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = CrimsonRed),
                    shape = RoundedCornerShape(12.dp),
                    enabled = !isAccepting
                ) {
                    if (isAccepting) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                    } else {
                        Text("ACCEPT & LOCK DISPATCH", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                OutlinedButton(
                    onClick = onBack,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = TextSecondary)
                ) {
                    Text("Decline / Stand Down")
                }
            }
        }
    }
}
