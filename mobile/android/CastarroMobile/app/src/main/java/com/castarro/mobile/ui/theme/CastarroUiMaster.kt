package com.castarro.mobile.ui.theme

import androidx.compose.material3.Typography as MaterialTypography
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object CastarroUiMaster {
    data class Palette(
        val Background: Color,
        val Surface: Color,
        val SurfaceSoft: Color,
        val NavigationDark: Color,
        val NavigationSoft: Color,
        val NavigationText: Color,
        val Ink: Color,
        val Muted: Color,
        val Line: Color,
        val Gold: Color,
        val GoldSoft: Color,
        val Green: Color,
        val TealDark: Color,
        val Danger: Color,
        val Warning: Color,
    )

    object Colors {
        val Light = Palette(
            Background = Color(0xFFF8F7F6),
            Surface = Color(0xFFFFFFFF),
            SurfaceSoft = Color(0xFFF1EEEE),
            NavigationDark = Color(0xFFD93F46),
            NavigationSoft = Color(0xFFE11D48),
            NavigationText = Color(0xFFFFFFFF),
            Ink = Color(0xFF171717),
            Muted = Color(0xFF66615F),
            Line = Color(0xFFDED8D5),
            Gold = Color(0xFFD93F46),
            GoldSoft = Color(0xFFFFB199),
            Green = Color(0xFF16A34A),
            TealDark = Color(0xFF171717),
            Danger = Color(0xFFE11D48),
            Warning = Color(0xFFD97706),
        )

        val Dark = Palette(
            Background = Color(0xFF101010),
            Surface = Color(0xFF1C1C1C),
            SurfaceSoft = Color(0xFF262626),
            NavigationDark = Color(0xFF1C1C1C),
            NavigationSoft = Color(0xFF262626),
            NavigationText = Color(0xFFFFFFFF),
            Ink = Color(0xFFFFFFFF),
            Muted = Color(0xFFAFAFAF),
            Line = Color(0xFF303030),
            Gold = Color(0xFFFF5A5F),
            GoldSoft = Color(0xFFFFB199),
            Green = Color(0xFF22C55E),
            TealDark = Color(0xFF101010),
            Danger = Color(0xFFFF1744),
            Warning = Color(0xFFF59E0B),
        )

        val Background = Light.Background
        val Surface = Light.Surface
        val SurfaceSoft = Light.SurfaceSoft
        val NavigationDark = Light.NavigationDark
        val NavigationSoft = Light.NavigationSoft
        val NavigationText = Light.NavigationText
        val Ink = Light.Ink
        val Muted = Light.Muted
        val Line = Light.Line
        val Gold = Light.Gold
        val GoldSoft = Light.GoldSoft
        val Green = Light.Green
        val TealDark = Light.TealDark
        val Danger = Light.Danger
        val Warning = Light.Warning

        fun palette(darkTheme: Boolean): Palette = if (darkTheme) Dark else Light
    }

    object Alpha {
        const val Badge = 0.14f
        const val LogoEmphasis = 0.22f
        const val Visible = 1f
        const val Hidden = 0f
        const val DragScale = 1.01f
    }

    object Space {
        val None = 0.dp
        val Hairline = 1.dp
        val Xxs = 2.dp
        val Xs = 3.dp
        val Sm = 4.dp
        val BadgeVertical = 5.dp
        val MetricHorizontal = 6.dp
        val Md = 8.dp
        val Lg = 10.dp
        val Xl = 12.dp
        val Page = 14.dp
        val Shell = 16.dp
    }

    object Radius {
        val Thumbnail = 6.dp
        val Control = 8.dp
    }

    object Size {
        val ActionButtonHeight = 48.dp
        val Logo = 38.dp
        val ThumbnailWidth = 74.dp
        val DragShift = 70.dp
        const val ThumbnailBitmapWidth = 296
        const val ThumbnailBitmapHeight = 166
    }

    object Elevation {
        val None = 0.dp
        val DraggedRow = 12.dp
    }

    object Aspect {
        const val Video = 16f / 9f
    }

    object Motion {
        const val RowDragMillis = 140
    }

    object TextSize {
        val HeadlineMedium = 24.sp
        val TitleLarge = 22.sp
        val TitleMedium = 16.sp
        val BodyMedium = 14.sp
        val LabelMedium = 12.sp
        val LabelLarge = 14.sp
        val UsageLabel = 11.sp
        val UsageValue = 12.sp
    }

    val Typography = MaterialTypography(
        headlineMedium = MaterialTypography().headlineMedium.copy(fontSize = TextSize.HeadlineMedium, fontWeight = FontWeight.Bold),
        titleLarge = MaterialTypography().titleLarge.copy(fontSize = TextSize.TitleLarge, fontWeight = FontWeight.Bold),
        titleMedium = MaterialTypography().titleMedium.copy(fontSize = TextSize.TitleMedium, fontWeight = FontWeight.SemiBold),
        bodyMedium = MaterialTypography().bodyMedium.copy(fontSize = TextSize.BodyMedium),
        labelMedium = MaterialTypography().labelMedium.copy(fontSize = TextSize.LabelMedium, fontWeight = FontWeight.SemiBold),
        labelLarge = MaterialTypography().labelLarge.copy(fontSize = TextSize.LabelLarge, fontWeight = FontWeight.Bold),
    )
}
