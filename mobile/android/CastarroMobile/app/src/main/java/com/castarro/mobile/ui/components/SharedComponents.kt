package com.castarro.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.castarro.mobile.ui.navigation.CastarroDestination
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun CastarroTopBar(title: String, channelName: String = "Inside Us", status: String = "Ready") {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Colors.NavigationDark)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, color = Colors.Surface, fontWeight = FontWeight.Bold)
            ToneBadge(status, "good")
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Colors.NavigationSoft)
                .border(1.dp, Colors.GoldSoft.copy(alpha = 0.22f), RoundedCornerShape(8.dp))
                .padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(Colors.Gold.copy(alpha = 0.22f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(channelName.first().uppercase(), color = Colors.GoldSoft, fontWeight = FontWeight.Bold)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(channelName, color = Colors.Surface, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Selected channel", color = Colors.GoldSoft)
            }
        }
    }
}

@Composable
fun CastarroBottomNav(selected: CastarroDestination, onSelected: (CastarroDestination) -> Unit) {
    NavigationBar(containerColor = Colors.Surface) {
        CastarroDestination.entries.forEach { destination ->
            NavigationBarItem(
                selected = selected == destination,
                onClick = { onSelected(destination) },
                icon = { Text(destination.label.take(1), fontWeight = FontWeight.Bold) },
                label = { Text(destination.label) },
            )
        }
    }
}

@Composable
fun SurfaceCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Colors.Surface)
            .border(1.dp, Colors.Line, RoundedCornerShape(8.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
fun ToneBadge(text: String, tone: String) {
    val color = when (tone) {
        "good" -> Colors.Green
        "warn" -> Colors.Warning
        "bad" -> Colors.Danger
        else -> Colors.Muted
    }
    Text(
        text = text,
        color = color,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = 8.dp, vertical = 5.dp),
    )
}

@Composable
fun ReadinessRow(label: String, value: String, badge: String, tone: String = "good") {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Colors.SurfaceSoft)
            .border(1.dp, Colors.Line, RoundedCornerShape(8.dp))
            .padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, color = Colors.Ink, fontWeight = FontWeight.Bold)
            Text(value, color = Colors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        ToneBadge(badge, tone)
    }
}

@Composable
fun StreamActionBar(isLive: Boolean, isReady: Boolean, onPrimary: () -> Unit = {}) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Button(
            onClick = onPrimary,
            enabled = isLive || isReady,
            colors = ButtonDefaults.buttonColors(
                containerColor = if (isLive) Colors.Danger else Colors.Green,
                disabledContainerColor = Colors.Line,
            ),
            modifier = Modifier
                .weight(1f)
                .height(48.dp),
        ) {
            Text(if (isLive) "Stop" else "Go Live")
        }
        OutlinedButton(onClick = {}, modifier = Modifier.height(48.dp)) {
            Text("Verify")
        }
    }
}
