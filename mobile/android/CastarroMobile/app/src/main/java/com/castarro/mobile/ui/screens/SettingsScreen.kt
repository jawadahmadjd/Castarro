package com.castarro.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.castarro.mobile.platform.StreamProtectionAction
import com.castarro.mobile.ui.MobileUiState
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.StreamProtectionPanel
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun SettingsScreen(
    state: MobileUiState,
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
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StreamProtectionPanel(
                title = "Live stream protection audit",
                items = state.streamProtection.items,
                emptyText = "No stream protection checks are available yet.",
                onAction = onStreamProtectionAction,
            )
        }
    }
}
