package com.castarro.mobile.domain.model

data class YoutubeBroadcast(
    val id: String,
    val title: String,
    val status: String,
    val ingestionUrl: String?,
    val streamNameSecretRef: String?,
)
