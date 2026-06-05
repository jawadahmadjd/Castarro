package com.castarro.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val CastarroScheme = lightColorScheme(
    primary = CastarroColors.Green,
    onPrimary = CastarroColors.Surface,
    secondary = CastarroColors.Gold,
    onSecondary = CastarroColors.Ink,
    background = CastarroColors.Background,
    onBackground = CastarroColors.Ink,
    surface = CastarroColors.Surface,
    onSurface = CastarroColors.Ink,
    error = CastarroColors.Danger,
)

@Composable
fun CastarroTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CastarroScheme,
        typography = CastarroTypography,
        content = content,
    )
}
