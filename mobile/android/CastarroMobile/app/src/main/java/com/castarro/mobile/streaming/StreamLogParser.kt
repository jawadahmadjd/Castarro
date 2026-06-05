package com.castarro.mobile.streaming

data class StreamLogMessage(val category: String, val userMessage: String)

class StreamLogParser {
    fun parse(line: String): StreamLogMessage? = when {
        "401 Unauthorized" in line || "Invalid argument" in line && "rtmp" in line ->
            StreamLogMessage("auth", "YouTube rejected the stream key.")
        "Connection refused" in line || "Network is unreachable" in line ->
            StreamLogMessage("network", "Connection lost. Castarro will try to reconnect.")
        "codec" in line.lowercase() && "not currently supported" in line.lowercase() ->
            StreamLogMessage("compatibility", "This video needs desktop prep before mobile streaming.")
        else -> null
    }
}
