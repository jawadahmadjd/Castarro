package com.castarro.mobile.domain.model

data class CastarroChannel(
    val id: String,
    val displayName: String,
    val avatarUri: String? = null,
    val defaultStreamProfileId: String? = null,
    val youtubeAccountId: String? = null,
    val createdAt: String,
    val updatedAt: String,
)
