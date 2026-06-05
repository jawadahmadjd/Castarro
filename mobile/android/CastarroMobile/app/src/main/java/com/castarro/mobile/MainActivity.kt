package com.castarro.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.castarro.mobile.ui.navigation.AppNavGraph
import com.castarro.mobile.ui.theme.CastarroTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            CastarroTheme {
                AppNavGraph()
            }
        }
    }
}
