package com.castarro.mobile.platform

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
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

    companion object {
        const val CHANNEL_ID = "castarro_live_streaming"
    }
}
