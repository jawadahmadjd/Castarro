package com.castarro.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Composable

@Composable
fun CastarroTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit,
) {
    val palette = CastarroUiMaster.Colors.palette(darkTheme)
    val scheme = if (darkTheme) {
        darkColorScheme(
            primary = palette.Gold,
            onPrimary = palette.NavigationText,
            secondary = palette.GoldSoft,
            onSecondary = palette.Ink,
            background = palette.Background,
            onBackground = palette.Ink,
            surface = palette.Surface,
            onSurface = palette.Ink,
            surfaceVariant = palette.SurfaceSoft,
            onSurfaceVariant = palette.Muted,
            outline = palette.Line,
            error = palette.Danger,
            onError = palette.NavigationText,
        )
    } else {
        lightColorScheme(
            primary = palette.Gold,
            onPrimary = palette.NavigationText,
            secondary = palette.GoldSoft,
            onSecondary = palette.Ink,
            background = palette.Background,
            onBackground = palette.Ink,
            surface = palette.Surface,
            onSurface = palette.Ink,
            surfaceVariant = palette.SurfaceSoft,
            onSurfaceVariant = palette.Muted,
            outline = palette.Line,
            error = palette.Danger,
            onError = palette.NavigationText,
        )
    }
    CompositionLocalProvider(LocalCastarroPalette provides palette) {
        MaterialTheme(
            colorScheme = scheme,
            typography = CastarroTypography,
            content = content,
        )
    }
}
