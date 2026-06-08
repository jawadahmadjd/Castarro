package com.castarro.mobile

import android.app.Application
import com.castarro.mobile.data.CastarroAppContainer

class CastarroApp : Application() {
    lateinit var container: CastarroAppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = CastarroAppContainer(this)
    }
}
