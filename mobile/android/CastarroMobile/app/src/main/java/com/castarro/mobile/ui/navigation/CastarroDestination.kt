package com.castarro.mobile.ui.navigation

import com.castarro.mobile.R

enum class CastarroDestination(val label: String, val iconRes: Int) {
    Home("Home", R.drawable.ic_tab_home),
    Video("Video", R.drawable.ic_tab_video),
    Youtube("YouTube", R.drawable.ic_tab_youtube),
    History("History", R.drawable.ic_tab_history),
    Settings("Settings", R.drawable.ic_tab_settings),
}
