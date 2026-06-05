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
import com.castarro.mobile.ui.components.ReadinessCard
import com.castarro.mobile.ui.components.StatusBand
import com.castarro.mobile.ui.components.StreamActionBar
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun HomeScreen(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Colors.Background),
    ) {
        ChannelHeader("Castarro", "Inside Us", "0 live")
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatusBand(video = "Ready", youtube = "Manual", stream = "Idle")
            SurfaceCard {
                Text("Selected Video", fontWeight = FontWeight.Bold)
                Text("ready-1.mp4", fontWeight = FontWeight.Bold)
                Text("1080p30 | H.264 | AAC | 42 min", color = Colors.Muted)
            }
            SurfaceCard {
                Text("Destination", fontWeight = FontWeight.Bold)
                Text("rtmps://a.rtmps.youtube.com/live2", color = Colors.Muted)
            }
            ReadinessCard()
            StreamActionBar(isLive = false, isReady = true)
        }
    }
}
