package com.castarro.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun StatusBand(video: String, youtube: String, stream: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, Colors.Line, RoundedCornerShape(8.dp)),
    ) {
        StatusCell("Video", video, Modifier.weight(1f))
        StatusCell("YouTube", youtube, Modifier.weight(1f))
        StatusCell("Stream", stream, Modifier.weight(1f))
    }
}

@Composable
private fun StatusCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(Colors.Surface)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(label, color = Colors.Green, fontWeight = FontWeight.Bold)
        Text(value, color = Colors.Ink, fontWeight = FontWeight.Bold)
    }
}
