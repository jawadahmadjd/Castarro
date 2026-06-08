package com.castarro.mobile.platform

import android.Manifest
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

enum class StreamProtectionLevel {
    Ok,
    Info,
    Warning,
    Critical,
}

enum class StreamProtectionAction {
    BatteryOptimization,
    NotificationSettings,
    AppSettings,
}

data class StreamProtectionItem(
    val id: String,
    val label: String,
    val detail: String,
    val level: StreamProtectionLevel,
    val action: StreamProtectionAction? = null,
)

data class StreamProtectionReport(
    val items: List<StreamProtectionItem> = emptyList(),
) {
    val warnings: List<StreamProtectionItem> =
        items.filter { it.level == StreamProtectionLevel.Warning || it.level == StreamProtectionLevel.Critical }

    val hasCriticalRisk: Boolean =
        items.any { it.level == StreamProtectionLevel.Critical }

    companion object {
        val Empty = StreamProtectionReport()
    }
}

class StreamProtectionMonitor(private val context: Context) {
    private val appContext = context.applicationContext

    fun currentReport(): StreamProtectionReport {
        val powerManager = appContext.getSystemService(PowerManager::class.java)
        val items = mutableListOf<StreamProtectionItem>()

        items += batteryOptimizationItem(powerManager)
        items += powerSaverItem(powerManager)
        items += notificationItem()
        items += foregroundServicePermissionItem()
        standbyBucketItem()?.let { items += it }

        return StreamProtectionReport(items)
    }

    fun intentFor(action: StreamProtectionAction): Intent =
        when (action) {
            StreamProtectionAction.BatteryOptimization -> batteryOptimizationIntent()
            StreamProtectionAction.NotificationSettings -> notificationSettingsIntent()
            StreamProtectionAction.AppSettings -> appSettingsIntent()
        }

    private fun batteryOptimizationItem(powerManager: PowerManager): StreamProtectionItem {
        val ignoringOptimizations = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            powerManager.isIgnoringBatteryOptimizations(appContext.packageName)
        return if (ignoringOptimizations) {
            StreamProtectionItem(
                id = "battery-optimization",
                label = "Battery optimization",
                detail = "Unrestricted for active live streaming.",
                level = StreamProtectionLevel.Ok,
            )
        } else {
            StreamProtectionItem(
                id = "battery-optimization",
                label = "Battery optimization",
                detail = "Android may stop the stream during inactivity or Doze unless Castarro is allowed to ignore optimization.",
                level = StreamProtectionLevel.Critical,
                action = StreamProtectionAction.BatteryOptimization,
            )
        }
    }

    private fun powerSaverItem(powerManager: PowerManager): StreamProtectionItem =
        if (powerManager.isPowerSaveMode) {
            StreamProtectionItem(
                id = "power-saver",
                label = "Battery saver",
                detail = "Battery saver is on and can restrict network, CPU, and background work during the live stream.",
                level = StreamProtectionLevel.Warning,
                action = StreamProtectionAction.AppSettings,
            )
        } else {
            StreamProtectionItem(
                id = "power-saver",
                label = "Battery saver",
                detail = "Off.",
                level = StreamProtectionLevel.Ok,
            )
        }

    private fun notificationItem(): StreamProtectionItem {
        val enabled = NotificationManagerCompat.from(appContext).areNotificationsEnabled()
        return if (enabled) {
            StreamProtectionItem(
                id = "notifications",
                label = "Live notification",
                detail = "Enabled with a visible Stop control.",
                level = StreamProtectionLevel.Ok,
            )
        } else {
            StreamProtectionItem(
                id = "notifications",
                label = "Live notification",
                detail = "Notifications are disabled, so the active stream status and Stop control may be hidden.",
                level = StreamProtectionLevel.Warning,
                action = StreamProtectionAction.NotificationSettings,
            )
        }
    }

    private fun foregroundServicePermissionItem(): StreamProtectionItem {
        val packageManager = appContext.packageManager
        val foregroundServiceGranted =
            packageManager.checkPermission(Manifest.permission.FOREGROUND_SERVICE, appContext.packageName) ==
                PackageManager.PERMISSION_GRANTED
        val dataSyncGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            packageManager.checkPermission(Manifest.permission.FOREGROUND_SERVICE_DATA_SYNC, appContext.packageName) ==
                PackageManager.PERMISSION_GRANTED
        val mediaPlaybackGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
            packageManager.checkPermission(Manifest.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK, appContext.packageName) ==
                PackageManager.PERMISSION_GRANTED

        return if (foregroundServiceGranted && dataSyncGranted && mediaPlaybackGranted) {
            StreamProtectionItem(
                id = "foreground-service",
                label = "Foreground streaming service",
                detail = "Declared for data upload and media playback, with wake lock support during streaming.",
                level = StreamProtectionLevel.Ok,
            )
        } else {
            StreamProtectionItem(
                id = "foreground-service",
                label = "Foreground streaming service",
                detail = "A required foreground service declaration is missing or unavailable; Android can block the stream start.",
                level = StreamProtectionLevel.Critical,
            )
        }
    }

    private fun standbyBucketItem(): StreamProtectionItem? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
        val usageStatsManager = appContext.getSystemService(UsageStatsManager::class.java)
        val bucket = usageStatsManager.appStandbyBucket
        return when {
            bucket >= UsageStatsManager.STANDBY_BUCKET_RESTRICTED -> StreamProtectionItem(
                id = "standby-bucket",
                label = "App standby",
                detail = "Android has placed Castarro in Restricted standby; this can kill or throttle live streaming.",
                level = StreamProtectionLevel.Critical,
                action = StreamProtectionAction.AppSettings,
            )
            bucket >= UsageStatsManager.STANDBY_BUCKET_RARE -> StreamProtectionItem(
                id = "standby-bucket",
                label = "App standby",
                detail = "Android has placed Castarro in a low-usage standby bucket; streaming reliability may be reduced.",
                level = StreamProtectionLevel.Warning,
                action = StreamProtectionAction.AppSettings,
            )
            else -> StreamProtectionItem(
                id = "standby-bucket",
                label = "App standby",
                detail = "Active enough for normal foreground streaming.",
                level = StreamProtectionLevel.Ok,
            )
        }
    }

    private fun batteryOptimizationIntent(): Intent {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${appContext.packageName}")
            }
        }
        return appSettingsIntent()
    }

    private fun notificationSettingsIntent(): Intent =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, appContext.packageName)
            }
        } else {
            appSettingsIntent()
        }

    private fun appSettingsIntent(): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${appContext.packageName}")
        }
}
