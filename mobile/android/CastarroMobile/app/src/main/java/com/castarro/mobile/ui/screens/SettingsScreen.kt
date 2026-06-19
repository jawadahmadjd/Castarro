package com.castarro.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.castarro.mobile.platform.StreamProtectionAction
import com.castarro.mobile.ui.MobileUiState
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.StreamProtectionPanel
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.theme.CastarroColors as Colors
import com.castarro.mobile.ui.theme.CastarroUiMaster as Ui

@Composable
fun SettingsScreen(
    state: MobileUiState,
    isDarkTheme: Boolean,
    onThemeChange: (Boolean) -> Unit,
    onChannelHeaderClick: () -> Unit,
    onStreamProtectionAction: (StreamProtectionAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val channelName = state.channel?.displayName ?: "Castarro"
    val streamStatus = state.activeSession?.status?.name ?: "Idle"

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Colors.Background),
    ) {
        ChannelHeader(
            title = "Settings",
            channelName = channelName,
            status = streamStatus,
            logoUri = state.channel?.logoUri,
            onChannelClick = onChannelHeaderClick,
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(Ui.Space.Page),
            verticalArrangement = Arrangement.spacedBy(Ui.Space.Xl),
        ) {
            SurfaceCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Theme")
                        Text(if (isDarkTheme) "Dark mode" else "Light mode", color = Colors.Muted)
                    }
                    Switch(checked = isDarkTheme, onCheckedChange = onThemeChange)
                }
            }
            StreamProtectionPanel(
                title = "Live stream protection audit",
                items = state.streamProtection.items,
                emptyText = "No stream protection checks are available yet.",
                onAction = onStreamProtectionAction,
            )
        }
    }
}
