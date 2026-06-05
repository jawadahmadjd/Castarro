package com.castarro.mobile.ui.navigation

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.castarro.mobile.ui.components.CastarroBottomNav
import com.castarro.mobile.ui.screens.HistoryScreen
import com.castarro.mobile.ui.screens.HomeScreen
import com.castarro.mobile.ui.screens.VideoLibraryScreen
import com.castarro.mobile.ui.screens.YoutubeScreen

@Composable
fun AppNavGraph() {
    var destination by remember { mutableStateOf(CastarroDestination.Home) }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        bottomBar = {
            CastarroBottomNav(
                selected = destination,
                onSelected = { destination = it },
            )
        },
    ) { padding ->
        val modifier = Modifier
            .fillMaxSize()
            .padding(padding)
        when (destination) {
            CastarroDestination.Home -> HomeScreen(modifier)
            CastarroDestination.Video -> VideoLibraryScreen(modifier)
            CastarroDestination.Youtube -> YoutubeScreen(modifier)
            CastarroDestination.History -> HistoryScreen(modifier)
        }
    }
}
