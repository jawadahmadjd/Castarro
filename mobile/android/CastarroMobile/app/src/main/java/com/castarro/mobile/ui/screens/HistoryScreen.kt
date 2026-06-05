package com.castarro.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.ReadinessRow
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun HistoryScreen(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Colors.Background),
    ) {
        ChannelHeader("History", "Inside Us", "Saved")
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SurfaceCard {
                Text("Recent sessions", fontWeight = FontWeight.Bold)
                ReadinessRow("Inside Us live", "Today | ready-1.mp4 | 42 min", "Done")
                ReadinessRow("Daily Tech", "Yesterday | ready-1.mp4 | 58 min", "Done")
                ReadinessRow("Travel replay", "Wrong stream key", "Failed", "bad")
            }
        }
    }
}
