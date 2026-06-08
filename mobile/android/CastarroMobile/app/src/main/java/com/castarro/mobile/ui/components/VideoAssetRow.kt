package com.castarro.mobile.ui.components

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.content.Context
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.castarro.mobile.ui.theme.CastarroColors as Colors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun VideoAssetRow(
    name: String,
    meta: String,
    badge: String,
    tone: String = "good",
    thumbnailPath: String? = null,
    thumbnailUri: String? = null,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Colors.SurfaceSoft)
            .border(1.dp, Colors.Line, RoundedCornerShape(8.dp))
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leading?.invoke()
        VideoThumbnail(
            path = thumbnailPath,
            uri = thumbnailUri,
            modifier = Modifier
                .width(74.dp)
                .aspectRatio(16f / 9f)
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 10.dp),
        ) {
            Text(name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(meta, color = Colors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        ToneBadge(badge, tone)
        trailing?.invoke()
    }
}

@Composable
private fun VideoThumbnail(path: String?, uri: String?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val thumbnail by produceState<Bitmap?>(initialValue = null, key1 = path, key2 = uri) {
        value = if (!path.isNullOrBlank() || !uri.isNullOrBlank()) {
            withContext(Dispatchers.IO) {
                extractVideoThumbnail(context, path, uri)
            }
        } else {
            null
        }
    }
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Colors.TealDark),
        contentAlignment = Alignment.Center,
    ) {
        thumbnail?.let { bitmap ->
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = null,
                modifier = Modifier.matchParentSize(),
                contentScale = ContentScale.Crop,
            )
        }
    }
}

private fun extractVideoThumbnail(context: Context, path: String?, uri: String?): Bitmap? {
    val retriever = MediaMetadataRetriever()
    return try {
        if (!path.isNullOrBlank()) {
            retriever.setDataSource(path)
        } else {
            retriever.setDataSource(context, Uri.parse(uri))
        }
        val frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            ?: retriever.getFrameAtTime()
            ?: return null
        Bitmap.createScaledBitmap(frame, 296, 166, true).also {
            if (it != frame) frame.recycle()
        }
    } catch (_: Exception) {
        null
    } finally {
        retriever.release()
    }
}
