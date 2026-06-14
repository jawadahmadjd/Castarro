package com.castarro.mobile.platform

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.castarro.mobile.data.sync.DesktopVideoDownloadForegroundService
import com.castarro.mobile.streaming.StreamForegroundService

class NotificationFactory(private val context: Context) {
    fun streamingNotification(
        channelName: String,
        videoName: String,
        status: String,
        elapsedText: String,
    ): Notification {
        ensureChannel()
        val stopIntent = Intent(context, StreamForegroundService::class.java).apply {
            action = StreamForegroundService.ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            context,
            40,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("$channelName is $status")
            .setContentText("$videoName | $elapsedText")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(status == "Live" || status == "Connecting" || status == "Reconnecting")
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .build()
    }

    fun desktopSyncDownloadNotification(
        channelName: String,
        status: String,
        detail: String,
        paused: Boolean,
    ): Notification {
        ensureDesktopSyncChannel()
        val pauseOrResumeIntent = Intent(context, DesktopVideoDownloadForegroundService::class.java).apply {
            action = if (paused) {
                DesktopVideoDownloadForegroundService.ACTION_RESUME
            } else {
                DesktopVideoDownloadForegroundService.ACTION_PAUSE
            }
        }
        val cancelIntent = Intent(context, DesktopVideoDownloadForegroundService::class.java).apply {
            action = DesktopVideoDownloadForegroundService.ACTION_CANCEL
        }
        val pauseOrResumePendingIntent = PendingIntent.getService(
            context,
            41,
            pauseOrResumeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val cancelPendingIntent = PendingIntent.getService(
            context,
            42,
            cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(context, DESKTOP_SYNC_CHANNEL_ID)
            .setContentTitle("$channelName desktop download")
            .setContentText("$status | $detail")
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(status == "Downloading" || status == "Paused")
            .addAction(
                if (paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
                if (paused) "Resume" else "Pause",
                pauseOrResumePendingIntent,
            )
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", cancelPendingIntent)
            .build()
    }

    fun desktopRemoteAlertNotification(
        channelName: String,
        title: String,
        detail: String,
        severe: Boolean,
    ): Notification {
        ensureDesktopRemoteChannel()
        return NotificationCompat.Builder(context, DESKTOP_REMOTE_CHANNEL_ID)
            .setContentTitle(title.ifBlank { "$channelName needs attention" })
            .setContentText(detail.ifBlank { channelName })
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail.ifBlank { channelName }))
            .setSmallIcon(if (severe) android.R.drawable.stat_notify_error else android.R.drawable.stat_notify_more)
            .setPriority(if (severe) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Live streaming",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Active Castarro mobile stream status and stop control."
        }
        manager.createNotificationChannel(channel)
    }

    private fun ensureDesktopSyncChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            DESKTOP_SYNC_CHANNEL_ID,
            "Desktop sync downloads",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Foreground status for desktop video downloads with pause and cancel controls."
        }
        manager.createNotificationChannel(channel)
    }

    private fun ensureDesktopRemoteChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            DESKTOP_REMOTE_CHANNEL_ID,
            "Desktop remote alerts",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Desktop stream alerts received through Castarro remote control."
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "castarro_live_streaming"
        const val DESKTOP_SYNC_CHANNEL_ID = "castarro_desktop_sync_downloads"
        const val DESKTOP_REMOTE_CHANNEL_ID = "castarro_desktop_remote_alerts"
    }
}
