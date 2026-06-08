package com.castarro.mobile.ui.components

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.castarro.mobile.platform.StreamProtectionAction
import com.castarro.mobile.platform.StreamProtectionItem
import com.castarro.mobile.platform.StreamProtectionLevel
import com.castarro.mobile.ui.navigation.CastarroDestination
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun CastarroTopBar(
    title: String,
    channelName: String = "Castarro",
    status: String = "Idle",
    logoUri: String? = null,
    onChannelClick: (() -> Unit)? = null,
) {
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
                .then(if (onChannelClick == null) Modifier else Modifier.clickable(onClick = onChannelClick))
                .padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChannelLogo(channelName = channelName, logoUri = logoUri)
            Column(modifier = Modifier.weight(1f)) {
                Text(channelName, color = Colors.Surface, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Selected channel", color = Colors.GoldSoft)
            }
        }
    }
}

@Composable
fun ChannelLogo(channelName: String, logoUri: String?, modifier: Modifier = Modifier) {
    val imageBitmap = rememberLogoBitmap(logoUri)
    Box(
        modifier = modifier
            .size(38.dp)
            .clip(CircleShape)
            .background(Colors.Gold.copy(alpha = 0.22f)),
        contentAlignment = Alignment.Center,
    ) {
        if (imageBitmap != null) {
            Image(
                bitmap = imageBitmap,
                contentDescription = null,
                modifier = Modifier.fillMaxWidth().height(38.dp),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text(
                channelInitial(channelName),
                color = Colors.GoldSoft,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun rememberLogoBitmap(logoUri: String?): ImageBitmap? {
    val context = LocalContext.current
    val image by produceState<ImageBitmap?>(initialValue = null, logoUri) {
        value = logoUri
            ?.takeIf { it.isNotBlank() }
            ?.let { uriText ->
                runCatching {
                    context.contentResolver.openInputStream(Uri.parse(uriText))?.use { input ->
                        BitmapFactory.decodeStream(input)?.asImageBitmap()
                    }
                }.getOrNull()
            }
    }
    return image
}

private fun channelInitial(channelName: String): String =
    channelName.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "C"

@Composable
fun CastarroBottomNav(selected: CastarroDestination, onSelected: (CastarroDestination) -> Unit) {
    NavigationBar(containerColor = Colors.Surface) {
        CastarroDestination.entries.forEach { destination ->
            NavigationBarItem(
                selected = selected == destination,
                onClick = { onSelected(destination) },
                icon = {
                    Icon(
                        painter = painterResource(destination.iconRes),
                        contentDescription = destination.label,
                    )
                },
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
    Button(
        onClick = onPrimary,
        enabled = isLive || isReady,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (isLive) Colors.Danger else Colors.Green,
            disabledContainerColor = Colors.Line,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
    ) {
        Text(if (isLive) "Stop Stream" else "Go Live")
    }
}

@Composable
fun StreamProtectionPanel(
    title: String,
    items: List<StreamProtectionItem>,
    emptyText: String,
    onAction: (StreamProtectionAction) -> Unit,
) {
    SurfaceCard {
        Text(title, fontWeight = FontWeight.Bold)
        if (items.isEmpty()) {
            Text(emptyText, color = Colors.Muted)
        }
        items.forEach { item ->
            StreamProtectionRow(item = item, onAction = onAction)
        }
    }
}

@Composable
private fun StreamProtectionRow(
    item: StreamProtectionItem,
    onAction: (StreamProtectionAction) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Colors.SurfaceSoft)
            .border(1.dp, Colors.Line, RoundedCornerShape(8.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(item.label, color = Colors.Ink, fontWeight = FontWeight.Bold)
                Text(item.detail, color = Colors.Muted)
            }
            ToneBadge(item.level.badgeText(), item.level.badgeTone())
        }
        item.action?.let { action ->
            Button(
                onClick = { onAction(action) },
                colors = ButtonDefaults.buttonColors(containerColor = Colors.Green),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(action.buttonText())
            }
        }
    }
}

private fun StreamProtectionLevel.badgeText(): String =
    when (this) {
        StreamProtectionLevel.Ok -> "OK"
        StreamProtectionLevel.Info -> "Info"
        StreamProtectionLevel.Warning -> "Warn"
        StreamProtectionLevel.Critical -> "Risk"
    }

private fun StreamProtectionLevel.badgeTone(): String =
    when (this) {
        StreamProtectionLevel.Ok -> "good"
        StreamProtectionLevel.Info -> "warn"
        StreamProtectionLevel.Warning -> "warn"
        StreamProtectionLevel.Critical -> "bad"
    }

private fun StreamProtectionAction.buttonText(): String =
    when (this) {
        StreamProtectionAction.BatteryOptimization -> "Allow unrestricted battery"
        StreamProtectionAction.NotificationSettings -> "Open notification settings"
        StreamProtectionAction.AppSettings -> "Open app settings"
    }
