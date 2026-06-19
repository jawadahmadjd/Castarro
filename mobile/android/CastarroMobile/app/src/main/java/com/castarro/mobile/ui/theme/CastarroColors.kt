package com.castarro.mobile.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

val LocalCastarroPalette = staticCompositionLocalOf { CastarroUiMaster.Colors.Light }

object CastarroColors {
    val Background: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Background
    val Surface: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Surface
    val SurfaceSoft: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.SurfaceSoft
    val NavigationDark: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.NavigationDark
    val NavigationSoft: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.NavigationSoft
    val NavigationText: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.NavigationText
    val Ink: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Ink
    val Muted: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Muted
    val Line: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Line
    val Gold: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Gold
    val GoldSoft: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.GoldSoft
    val Green: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Green
    val TealDark: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.TealDark
    val Danger: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Danger
    val Warning: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalCastarroPalette.current.Warning
}
