package com.castarro.mobile.ui.components

import androidx.compose.runtime.Composable

@Composable
fun ChannelHeader(title: String, channelName: String, status: String) {
    CastarroTopBar(title = title, channelName = channelName, status = status)
}
