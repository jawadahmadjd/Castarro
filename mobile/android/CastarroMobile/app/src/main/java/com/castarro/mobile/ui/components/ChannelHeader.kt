package com.castarro.mobile.ui.components

import androidx.compose.runtime.Composable

@Composable
fun ChannelHeader(
    title: String,
    channelName: String,
    status: String,
    logoUri: String? = null,
    onChannelClick: (() -> Unit)? = null,
) {
    CastarroTopBar(
        title = title,
        channelName = channelName,
        status = status,
        logoUri = logoUri,
        onChannelClick = onChannelClick,
    )
}
