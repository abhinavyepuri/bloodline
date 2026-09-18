# SmartBlood Mobile Application (Android)

Native Android voluntary donor emergency response and field dispatch app built with **Kotlin** and **Jetpack Compose**, integrated with the **FastAPI** Python backend.

---

## 📱 Features

- **JWT Authentication & Profile Management**: Secure sign-in communicating with `POST /api/v1/auth/login` and session restoration via `GET /api/v1/auth/me`.
- **Donor Availability Toggle**: Instant availability and location syncing to the backend matching engine via `PATCH /api/v1/donors/availability`.
- **Proximity Geofencing & Push Alerts**: Real-time incoming dispatch notifications via WebSocket (`/api/v1/realtime/ws?token=<jwt>`).
- **Contextual 1-Tap Slot Claiming**: Respond directly with `ACCEPT` or `DECLINE` via `POST /api/v1/donors/respond` without entering long UUIDs.
- **Short-Code Emergency Matching**: Supports human-readable emergency codes (e.g. `REQ-8492`) via `POST /api/v1/donors/requests/{id}/respond`.
- **In-Transit GPS Telemetry Stream**: Streams real-time GPS coordinates and speed via `POST /api/v1/donors/me/telemetry`, triggering hospital trauma ward alerts when entering within 500m of the destination.
- **Mobile Resilience & Idempotency**: Emits `Idempotency-Key` headers on dispatch responses to prevent duplicate claims over spotty cellular data.

---

## 🏗️ Architecture & Folder Layout

```text
mobile/
├── settings.gradle.kts          # Root Gradle settings
├── build.gradle.kts             # Top-level build config
├── gradle.properties            # JVM & AndroidX memory options
├── gradle/
│   └── libs.versions.toml       # Version Catalog (Compose, Retrofit, OkHttp)
└── app/
    ├── build.gradle.kts         # App-level dependencies & Compose setup
    ├── src/main/
    │   ├── AndroidManifest.xml  # Permissions (INTERNET, ACCESS_FINE_LOCATION)
    │   ├── res/
    │   │   ├── values/strings.xml
    │   │   └── xml/network_security_config.xml
    │   └── java/com/smartblood/mobile/
    │       ├── MainActivity.kt
    │       ├── data/
    │       │   ├── api/ApiClient.kt                # Retrofit HTTP client with Idempotency & Auth Interceptor
    │       │   ├── api/BloodBankApiService.kt      # REST service endpoints (/auth, /donors, /telemetry)
    │       │   ├── models/                         # Auth, BloodRequest, Telemetry data models
    │       │   └── websocket/BloodWebSocketClient.kt # OkHttp WebSocket client for real-time alerts
    │       └── ui/
    │           ├── theme/                          # Material3 Dark Crimson theme
    │           └── screens/                        # Compose screens (LoginScreen, HomeScreen, DispatchAlertScreen)
```

---

## 🚀 Running the App

### 1. Backend Connectivity
- **Android Emulator**: Uses `http://10.0.2.2:8000/api/v1/` by default (maps to `localhost:8000` on host machine).
- **Physical Device**: Update `ApiClient.BASE_URL` and `ApiClient.WS_URL` in `data/api/ApiClient.kt` to your host computer's LAN IP (e.g., `http://192.168.1.100:8000/api/v1/`).

### 2. Open in Android Studio
1. Launch Android Studio.
2. Select **Open** and choose the `mobile/` directory.
3. Allow Gradle to sync dependencies.
4. Run on an Android Emulator or connected physical device (API Level 26+).

---

## 🧪 Demo Donor Accounts

Use any of the seeded donor accounts to test mobile dispatch responses:
- `alice@donor.org` (Password: `password123`) — $O^-$ Donor, 1.9 km from Metro General
- `bob@donor.org` (Password: `password123`) — $O^-$ Donor, 3.6 km from Metro General
