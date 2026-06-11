package com.castarro.mobile.data.sync

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.room.Room
import com.castarro.mobile.data.db.CastarroDatabase
import com.castarro.mobile.data.db.VideoAssetEntity
import com.castarro.mobile.platform.NotificationFactory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class DesktopVideoDownloadForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var notifications: NotificationFactory
    private lateinit var database: CastarroDatabase
    private var activeJob: kotlinx.coroutines.Job? = null
    private var currentConnection: HttpURLConnection? = null
    private var paused = false
    private var cancelRequested = false
    private var totalCount = 0
    private var completedCount = 0
    private var channelName = "Desktop sync"
    private var activeVideoName: String? = null
    private var wakeLock: PowerManager.WakeLock? = null

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
            ACTION_START -> {
                startDownloads(intent)
                START_REDELIVER_INTENT
            }
            ACTION_PAUSE -> {
                pauseDownloads()
                START_NOT_STICKY
            }
            ACTION_RESUME -> {
                resumeDownloads()
                START_NOT_STICKY
            }
            ACTION_CANCEL -> {
                cancelDownloads()
                START_NOT_STICKY
            }
            else -> START_NOT_STICKY
        }
    }

    override fun onDestroy() {
        currentConnection?.disconnect()
        releaseWakeLock()
        scope.cancel()
        super.onDestroy()
    }

    private fun startDownloads(intent: Intent) {
        if (activeJob?.isActive == true) return
        val videoIds = intent.getStringArrayListExtra(EXTRA_VIDEO_IDS).orEmpty().distinct()
        if (videoIds.isEmpty()) {
            stopSelf()
            return
        }
        channelName = intent.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty().ifBlank { "Desktop sync" }
        paused = false
        cancelRequested = false
        completedCount = 0
        totalCount = videoIds.size
        activeVideoName = null
        acquireWakeLock()
        updateTask(DesktopVideoDownloadPhase.Running, "Preparing downloads")
        startDownloadForeground("Preparing", "0 of $totalCount downloaded", paused = false)
        activeJob = scope.launch {
            runCatching {
                downloadQueue(videoIds)
            }.onSuccess {
                updateTask(DesktopVideoDownloadPhase.Completed, "Downloaded $completedCount of $totalCount videos.")
                stopForeground(STOP_FOREGROUND_REMOVE)
                releaseWakeLock()
                stopSelf()
            }.onFailure { error ->
                val wasCancelled = cancelRequested || error is CancellationException
                updateTask(
                    if (wasCancelled) DesktopVideoDownloadPhase.Cancelled else DesktopVideoDownloadPhase.Failed,
                    if (wasCancelled) "Download cancelled." else (error.message ?: "Desktop video download failed."),
                )
                stopForeground(STOP_FOREGROUND_REMOVE)
                releaseWakeLock()
                stopSelf()
            }
        }
    }

    private suspend fun downloadQueue(videoIds: List<String>) {
        val videosById = database.videoAssetDao().getByIds(videoIds).associateBy { it.id }
        for (videoId in videoIds) {
            if (cancelRequested) throw CancellationException("Cancelled")
            val video = videosById[videoId] ?: continue
            if (video.localPath?.isNotBlank() == true) {
                completedCount += 1
                continue
            }
            if (!video.sourceUri.startsWith("http")) continue
            activeVideoName = video.displayName
            database.videoAssetDao().upsert(
                video.copy(
                    compatibilityStatus = "NeedsDesktopPrep",
                    compatibilityMessage = "Downloading from desktop.",
                ),
            )
            updateTask(
                if (paused) DesktopVideoDownloadPhase.Paused else DesktopVideoDownloadPhase.Running,
                "${completedCount} of $totalCount downloaded",
            )
            val localPath = try {
                downloadVideo(video)
            } catch (error: Exception) {
                database.videoAssetDao().upsert(
                    video.copy(
                        compatibilityStatus = "NeedsDesktopPrep",
                        compatibilityMessage = "Ready to download from desktop.",
                    ),
                )
                throw error
            }
            database.videoAssetDao().upsert(
                video.copy(
                    localPath = localPath,
                    compatibilityStatus = "Ready",
                    compatibilityMessage = "Synced from desktop.",
                ),
            )
            completedCount += 1
            activeVideoName = null
            updateTask(
                if (paused) DesktopVideoDownloadPhase.Paused else DesktopVideoDownloadPhase.Running,
                "$completedCount of $totalCount downloaded",
            )
        }
    }

    private suspend fun downloadVideo(video: VideoAssetEntity): String {
        val targetDir = File(filesDir, "synced-videos").apply { mkdirs() }
        val cleanName = video.displayName.replace(Regex("""[<>:"/\\|?*]+"""), "_").ifBlank { "${video.id}.mp4" }
        val target = uniqueFile(File(targetDir, cleanName))
        val connection = (URL(video.sourceUri).openConnection() as HttpURLConnection).also { currentConnection = it }
        try {
            connection.connectTimeout = 10_000
            connection.readTimeout = 60_000
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("Desktop video download failed.")
            }
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (scope.isActive) {
                        ensureNotCancelled()
                        waitIfPaused()
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                    }
                }
            }
            return target.absolutePath
        } catch (error: Exception) {
            if (target.exists()) {
                target.delete()
            }
            if (error is CancellationException) throw error
            throw error
        } finally {
            currentConnection?.disconnect()
            currentConnection = null
        }
    }

    private suspend fun waitIfPaused() {
        while (paused && !cancelRequested) {
            updateTask(DesktopVideoDownloadPhase.Paused, "$completedCount of $totalCount downloaded")
            delay(250)
        }
        ensureNotCancelled()
    }

    private fun ensureNotCancelled() {
        if (cancelRequested) throw CancellationException("Cancelled")
    }

    private fun pauseDownloads() {
        if (activeJob?.isActive != true) return
        paused = true
        updateTask(DesktopVideoDownloadPhase.Paused, "$completedCount of $totalCount downloaded")
    }

    private fun resumeDownloads() {
        if (activeJob?.isActive != true) return
        paused = false
        updateTask(DesktopVideoDownloadPhase.Running, "$completedCount of $totalCount downloaded")
    }

    private fun cancelDownloads() {
        cancelRequested = true
        paused = false
        currentConnection?.disconnect()
        activeJob?.cancel()
    }

    private fun updateTask(phase: DesktopVideoDownloadPhase, message: String) {
        DesktopVideoDownloadCoordinator.update(
            DesktopVideoDownloadTask(
                phase = phase,
                totalCount = totalCount,
                completedCount = completedCount,
                activeVideoName = activeVideoName,
                message = message,
            ),
        )
        if (phase != DesktopVideoDownloadPhase.Idle) {
            val status = when (phase) {
                DesktopVideoDownloadPhase.Running -> "Downloading"
                DesktopVideoDownloadPhase.Paused -> "Paused"
                DesktopVideoDownloadPhase.Completed -> "Completed"
                DesktopVideoDownloadPhase.Cancelled -> "Cancelled"
                DesktopVideoDownloadPhase.Failed -> "Failed"
                DesktopVideoDownloadPhase.Idle -> "Idle"
            }
            val detail = listOfNotNull(activeVideoName, message).joinToString(" | ")
            notifyForeground(status, detail, phase == DesktopVideoDownloadPhase.Paused)
        }
    }

    private fun startDownloadForeground(status: String, detail: String, paused: Boolean) {
        val notification = notifications.desktopSyncDownloadNotification(channelName, status, detail, paused)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun notifyForeground(status: String, detail: String, paused: Boolean) {
        val manager = getSystemService(android.app.NotificationManager::class.java)
        manager.notify(
            NOTIFICATION_ID,
            notifications.desktopSyncDownloadNotification(channelName, status, detail, paused),
        )
    }

    private fun uniqueFile(file: File): File {
        if (!file.exists()) return file
        val name = file.nameWithoutExtension
        val extension = file.extension.takeIf { it.isNotBlank() }?.let { ".$it" }.orEmpty()
        var index = 2
        while (true) {
            val candidate = File(file.parentFile, "$name-$index$extension")
            if (!candidate.exists()) return candidate
            index += 1
        }
    }

    private fun acquireWakeLock() {
        val existing = wakeLock
        if (existing?.isHeld == true) return
        val powerManager = getSystemService(PowerManager::class.java)
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Castarro:DesktopSyncDownload").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    companion object {
        const val ACTION_START = "com.castarro.mobile.desktopsync.START"
        const val ACTION_PAUSE = "com.castarro.mobile.desktopsync.PAUSE"
        const val ACTION_RESUME = "com.castarro.mobile.desktopsync.RESUME"
        const val ACTION_CANCEL = "com.castarro.mobile.desktopsync.CANCEL"
        const val EXTRA_VIDEO_IDS = "videoIds"
        const val EXTRA_CHANNEL_NAME = "channelName"
        private const val NOTIFICATION_ID = 4102
    }
}
