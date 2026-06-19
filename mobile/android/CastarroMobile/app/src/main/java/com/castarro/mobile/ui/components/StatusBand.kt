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
import com.castarro.mobile.ui.theme.CastarroColors as Colors
import com.castarro.mobile.ui.theme.CastarroUiMaster as Ui

@Composable
fun StatusBand(video: String, youtube: String, stream: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Ui.Radius.Control))
            .border(Ui.Space.Hairline, Colors.Line, RoundedCornerShape(Ui.Radius.Control)),
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
            .padding(Ui.Space.Lg),
        verticalArrangement = Arrangement.spacedBy(Ui.Space.Sm),
    ) {
        Text(label, color = Colors.Green, fontWeight = FontWeight.Bold)
        Text(value, color = Colors.Ink, fontWeight = FontWeight.Bold)
    }
}
