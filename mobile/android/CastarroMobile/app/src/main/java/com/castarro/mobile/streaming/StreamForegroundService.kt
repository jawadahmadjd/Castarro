package com.castarro.mobile.streaming

import android.app.Service
import android.content.pm.ServiceInfo
import android.content.Intent
import android.net.TrafficStats
import android.os.Build
import android.os.IBinder
import android.os.Process
import android.os.PowerManager
import androidx.room.Room
import com.castarro.mobile.data.db.CastarroDatabase
import com.castarro.mobile.platform.NotificationFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.time.Duration
import java.time.Instant

class StreamForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val runner = StreamProcessRunner()
    private val reconnectPolicy = StreamReconnectPolicy()
    private lateinit var notifications: NotificationFactory
    private lateinit var database: CastarroDatabase
    private var startedAt: Instant? = null
    private var activeSessionId: String? = null
    private var stopRequested = false
    private var streamStartTxBytes: Long = 0L
    private var streamWakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        notifications = NotificationFactory(this)
        database = Room.databaseBuilder(
            applicationContext,
            CastarroDatabase::class.java,
            "castarro_mobile.db",
        )
            .addMigrations(CastarroDatabase.MIGRATION_1_2)
            .build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_STOP -> {
                stopStreaming()
                START_NOT_STICKY
            }
            ACTION_START -> {
                startStreaming(intent)
                START_REDELIVER_INTENT
            }
            else -> {
                START_NOT_STICKY
            }
        }
    }

    override fun onDestroy() {
        runner.stop()
        releaseStreamWakeLock()
        scope.cancel()
        super.onDestroy()
    }

    private fun startStreaming(intent: Intent?) {
        val channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME) ?: "Castarro"
        val videoName = intent?.getStringExtra(EXTRA_VIDEO_NAME) ?: "Selected video"
        val command = intent?.getStringArrayListExtra(EXTRA_COMMAND).orEmpty()
        val logPath = intent?.getStringExtra(EXTRA_LOG_PATH)
        val sessionId = intent?.getStringExtra(EXTRA_SESSION_ID)
        startedAt = Instant.now()
        activeSessionId = sessionId
        stopRequested = false
        streamStartTxBytes = currentUidTxBytes()

        acquireStreamWakeLock()
        startStreamForeground(channelName, videoName, "Connecting")

        if (command.isEmpty()) {
            scope.launch {
                finishSession(sessionId, "Failed", -1, "Stream command was empty.")
                stopSelf()
            }
            updateNotification(channelName, videoName, "Failed")
            return
        }

        scope.launch {
            val logFile = logPath?.let { File(it) }
            val exitCode = runStreamWithReconnects(
                command = command,
                logFile = logFile,
                sessionId = sessionId,
                channelName = channelName,
                videoName = videoName,
            )
            val stoppedByUser = stopRequested
            finishSession(
                sessionId,
                if (exitCode == 0 || stoppedByUser) "Stopped" else "Failed",
                exitCode,
                if (exitCode == 0 || stoppedByUser) null else "FFmpeg exited with code $exitCode.",
            )
            releaseStreamWakeLock()
            updateNotification(
                channelName,
                videoName,
                if (exitCode == 0 || stoppedByUser) "Stopped" else "Failed",
            )
            if (exitCode == 0 || stoppedByUser) stopSelf()
        }
    }

    private suspend fun runStreamWithReconnects(
        command: List<String>,
        logFile: File?,
        sessionId: String?,
        channelName: String,
        videoName: String,
    ): Int {
        var attempt = 0
        var lastExitCode = -1
        while (!stopRequested) {
            if (attempt == 0) {
                sessionId?.let { database.streamSessionDao().updateStatus(it, "Live") }
                updateNotification(channelName, videoName, "Live")
            } else {
                sessionId?.let { database.streamSessionDao().updateStatus(it, "Reconnecting") }
                updateNotification(channelName, videoName, "Reconnecting")
                logFile?.appendText("Reconnect attempt $attempt starting.\n")
            }

            lastExitCode = runCatching {
                runner.run(command) { line ->
                    logFile?.appendText("$line\n")
                }
            }.getOrElse { error ->
                logFile?.appendText("${error.message}\n")
                -1
            }

            if (lastExitCode == 0 || stopRequested) return lastExitCode

            attempt += 1
            val reconnectDelayMs = reconnectPolicy.delayForAttempt(attempt) ?: break
            sessionId?.let { database.streamSessionDao().updateStatus(it, "Reconnecting") }
            updateNotification(channelName, videoName, "Reconnecting")
            logFile?.appendText(
                "Stream interrupted with FFmpeg exit code $lastExitCode. " +
                    "Reconnecting in ${reconnectDelayMs / 1_000.0} seconds.\n",
            )
            delay(reconnectDelayMs)
        }
        return lastExitCode
    }

    private fun stopStreaming() {
        stopRequested = true
        runner.stop()
        releaseStreamWakeLock()
        activeSessionId?.let { sessionId ->
            scope.launch {
                finishSession(sessionId, "Stopped", null, null)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            return
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private suspend fun finishSession(
        sessionId: String?,
        status: String,
        exitCode: Int?,
        failureReason: String?,
    ) {
        if (sessionId == null) return
        val uploadedBytes = (currentUidTxBytes() - streamStartTxBytes).coerceAtLeast(0L)
        database.streamSessionDao().updateBytesUploaded(sessionId, uploadedBytes)
        database.streamSessionDao().finishSession(
            sessionId = sessionId,
            status = status,
            endedAt = Instant.now().toString(),
            exitCode = exitCode,
            failureReason = failureReason,
        )
    }

    private fun currentUidTxBytes(): Long =
        TrafficStats.getUidTxBytes(Process.myUid()).takeIf { it != TrafficStats.UNSUPPORTED.toLong() } ?: 0L

    private fun updateNotification(channelName: String, videoName: String, status: String) {
        val manager = getSystemService(android.app.NotificationManager::class.java)
        manager.notify(
            NOTIFICATION_ID,
            notifications.streamingNotification(channelName, videoName, status, elapsedText()),
        )
    }

    private fun elapsedText(): String {
        val start = startedAt ?: return "00:00"
        val elapsed = Duration.between(start, Instant.now()).coerceAtLeast(Duration.ZERO)
        val minutes = elapsed.toMinutes()
        val seconds = elapsed.minusMinutes(minutes).seconds
        return "%02d:%02d".format(minutes, seconds)
    }

    private fun startStreamForeground(channelName: String, videoName: String, status: String) {
        val notification = notifications.streamingNotification(channelName, videoName, status, elapsedText())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun acquireStreamWakeLock() {
        val existing = streamWakeLock
        if (existing?.isHeld == true) return
        val powerManager = getSystemService(PowerManager::class.java)
        streamWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Castarro:LiveStream").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseStreamWakeLock() {
        streamWakeLock?.takeIf { it.isHeld }?.release()
        streamWakeLock = null
    }

    companion object {
        const val ACTION_START = "com.castarro.mobile.streaming.START"
        const val ACTION_STOP = "com.castarro.mobile.streaming.STOP"
        const val EXTRA_CHANNEL_NAME = "channelName"
        const val EXTRA_VIDEO_NAME = "videoName"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_LOG_PATH = "logPath"
        const val EXTRA_SESSION_ID = "sessionId"
        private const val NOTIFICATION_ID = 4101
    }
}
