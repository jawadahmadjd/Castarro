package com.castarro.mobile.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val CastarroTypography = Typography(
    headlineMedium = Typography().headlineMedium.copy(fontSize = 24.sp, fontWeight = FontWeight.Bold),
    titleLarge = Typography().titleLarge.copy(fontSize = 22.sp, fontWeight = FontWeight.Bold),
    titleMedium = Typography().titleMedium.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    bodyMedium = Typography().bodyMedium.copy(fontSize = 14.sp),
    labelMedium = Typography().labelMedium.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
    labelLarge = Typography().labelLarge.copy(fontSize = 14.sp, fontWeight = FontWeight.Bold),
)
