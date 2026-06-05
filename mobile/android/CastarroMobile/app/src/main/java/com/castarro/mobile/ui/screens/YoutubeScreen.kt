package com.castarro.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.castarro.mobile.ui.components.ChannelHeader
import com.castarro.mobile.ui.components.ReadinessRow
import com.castarro.mobile.ui.components.SurfaceCard
import com.castarro.mobile.ui.theme.CastarroColors as Colors

@Composable
fun YoutubeScreen(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Colors.Background),
    ) {
        ChannelHeader("YouTube", "Inside Us", "Manual")
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SurfaceCard {
                Text("Manual stream key", fontWeight = FontWeight.Bold)
                OutlinedTextField(
                    value = "rtmps://a.rtmps.youtube.com/live2",
                    onValueChange = {},
                    label = { Text("RTMPS URL") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = "abcd-efgh-ijkl-mnop",
                    onValueChange = {},
                    label = { Text("Stream key") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
            }
            SurfaceCard {
                Text("YouTube account mode", fontWeight = FontWeight.Bold)
                Text("Google OAuth and broadcast selection are prepared as a future shared feature.", color = Colors.Muted)
            }
            SurfaceCard {
                Text("Studio checks", fontWeight = FontWeight.Bold)
                ReadinessRow("Auto Start", "YouTube Studio", "On")
                ReadinessRow("Auto Stop", "YouTube Studio", "On")
            }
        }
    }
}
