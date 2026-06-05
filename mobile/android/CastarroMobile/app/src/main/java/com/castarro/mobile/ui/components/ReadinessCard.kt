package com.castarro.mobile.ui.components

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.FontWeight

@Composable
fun ReadinessCard() {
    SurfaceCard {
        Text("Readiness", fontWeight = FontWeight.Bold)
        ReadinessRow("Video file", "ready-1.mp4", "Ready")
        ReadinessRow("Copy-mode compatibility", "H.264 video, AAC audio", "Ready")
        ReadinessRow("YouTube destination", "Manual RTMPS profile", "Linked")
        ReadinessRow("Auto Start/Stop", "Confirmed in Studio", "On")
    }
}
