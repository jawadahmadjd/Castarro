package com.castarro.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.ReadinessRow
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.components.VideoAssetRow
import com.castarro.mobile.platform.rememberVideoFilePicker
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun VideoLibraryScreen(modifier: Modifier = Modifier) {
    var selectedVideo by remember { mutableStateOf("ready-1.mp4") }
    val picker = rememberVideoFilePicker { uri ->
        selectedVideo = uri.lastPathSegment?.substringAfterLast('/') ?: "selected-video.mp4"
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Colors.Background),
    ) {
        ChannelHeader("Video", "Inside Us", "Ready")
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SurfaceCard {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Phone Videos", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Button(
                        onClick = { picker.launch(arrayOf("video/mp4", "video/quicktime", "video/*")) },
                        colors = ButtonDefaults.buttonColors(containerColor = Colors.Gold, contentColor = Colors.Ink),
                    ) {
                        Text("Select")
                    }
                }
                VideoAssetRow(selectedVideo, "Selected from phone", "Ready")
                VideoAssetRow("travel-hevc.mov", "HEVC | 4K", "Prep", "warn")
            }
            SurfaceCard {
                Text("Compatibility", fontWeight = FontWeight.Bold)
                ReadinessRow("Video codec", "H.264", "Pass")
                ReadinessRow("Audio codec", "AAC stereo", "Pass")
                ReadinessRow("Live pacing", "Stable timestamps", "Pass")
            }
            SurfaceCard {
                Text("Needs desktop prep", fontWeight = FontWeight.Bold)
                Text("Open Castarro Desktop and normalize blocked files before streaming.", color = Colors.Muted)
            }
        }
    }
}
