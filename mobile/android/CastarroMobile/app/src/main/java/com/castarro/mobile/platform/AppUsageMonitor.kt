package com.castarro.mobile.platform

import android.content.Context
import android.net.TrafficStats
import android.os.Debug
import android.os.Process
import android.os.SystemClock
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.time.LocalDate

data class AppUsageSnapshot(
    val cpuPercent: Double = 0.0,
    val ramBytes: Long = 0,
    val dataTransferredTodayBytes: Long = 0,
    val dataSentTodayBytes: Long = 0,
    val dataReceivedTodayBytes: Long = 0,
    val batteryTodayLabel: String = "Unavailable",
    val batteryTodayDetail: String = "Android does not expose exact per-app battery consumption through public APIs.",
)

class AppUsageMonitor(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences("castarro_app_usage", Context.MODE_PRIVATE)

    fun snapshots(intervalMs: Long = 2_000): Flow<AppUsageSnapshot> = flow {
        var previousCpuMs = Process.getElapsedCpuTime()
        var previousElapsedMs = SystemClock.elapsedRealtime()
        ensureTodayNetworkBaseline()

        while (true) {
            delay(intervalMs)
            val currentCpuMs = Process.getElapsedCpuTime()
            val currentElapsedMs = SystemClock.elapsedRealtime()
            val cpuDeltaMs = (currentCpuMs - previousCpuMs).coerceAtLeast(0)
            val elapsedDeltaMs = (currentElapsedMs - previousElapsedMs).coerceAtLeast(1)
            val cpuPercent = cpuDeltaMs.toDouble() / elapsedDeltaMs.toDouble() /
                Runtime.getRuntime().availableProcessors().coerceAtLeast(1).toDouble() * 100.0

            previousCpuMs = currentCpuMs
            previousElapsedMs = currentElapsedMs

            emit(
                AppUsageSnapshot(
                    cpuPercent = cpuPercent.coerceAtLeast(0.0),
                    ramBytes = currentRamBytes(),
                    dataTransferredTodayBytes = dataTransferredTodayBytes(),
                    dataSentTodayBytes = dataSentTodayBytes(),
                    dataReceivedTodayBytes = dataReceivedTodayBytes(),
                ),
            )
        }
    }

    private fun currentRamBytes(): Long {
        val memoryInfo = Debug.MemoryInfo()
        Debug.getMemoryInfo(memoryInfo)
        return memoryInfo.totalPss.toLong().coerceAtLeast(0) * 1024L
    }

    private fun dataTransferredTodayBytes(): Long =
        dataSentTodayBytes() + dataReceivedTodayBytes()

    private fun dataSentTodayBytes(): Long {
        val current = currentTxBytes()
        val baseline = ensureTodayNetworkBaseline().txBytes
        if (current < baseline) {
            saveTodayNetworkBaseline(current, currentRxBytes())
            return 0L
        }
        return (current - baseline).coerceAtLeast(0)
    }

    private fun dataReceivedTodayBytes(): Long {
        val current = currentRxBytes()
        val baseline = ensureTodayNetworkBaseline().rxBytes
        if (current < baseline) {
            saveTodayNetworkBaseline(currentTxBytes(), current)
            return 0L
        }
        return (current - baseline).coerceAtLeast(0)
    }

    private fun ensureTodayNetworkBaseline(): NetworkBaseline {
        val today = LocalDate.now().toString()
        val savedDate = preferences.getString(KEY_DATE, "")
        val savedTx = preferences.getLong(KEY_TX_BASELINE, -1L)
        val savedRx = preferences.getLong(KEY_RX_BASELINE, -1L)
        if (savedDate == today && savedTx >= 0 && savedRx >= 0) {
            return NetworkBaseline(savedTx, savedRx)
        }
        return saveTodayNetworkBaseline(currentTxBytes(), currentRxBytes())
    }

    private fun saveTodayNetworkBaseline(txBytes: Long, rxBytes: Long): NetworkBaseline {
        val baseline = NetworkBaseline(txBytes.coerceAtLeast(0), rxBytes.coerceAtLeast(0))
        preferences.edit()
            .putString(KEY_DATE, LocalDate.now().toString())
            .putLong(KEY_TX_BASELINE, baseline.txBytes)
            .putLong(KEY_RX_BASELINE, baseline.rxBytes)
            .apply()
        return baseline
    }

    private fun currentTxBytes(): Long =
        TrafficStats.getUidTxBytes(Process.myUid()).takeIf { it != TrafficStats.UNSUPPORTED.toLong() } ?: 0L

    private fun currentRxBytes(): Long =
        TrafficStats.getUidRxBytes(Process.myUid()).takeIf { it != TrafficStats.UNSUPPORTED.toLong() } ?: 0L

    private data class NetworkBaseline(val txBytes: Long, val rxBytes: Long)

    private companion object {
        const val KEY_DATE = "network_baseline_date"
        const val KEY_TX_BASELINE = "network_tx_baseline"
        const val KEY_RX_BASELINE = "network_rx_baseline"
    }
}
