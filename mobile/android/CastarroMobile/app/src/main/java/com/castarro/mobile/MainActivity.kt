package com.castarro.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.castarro.mobile.ui.CastarroMobileViewModel
import com.castarro.mobile.ui.navigation.AppNavGraph
import com.castarro.mobile.ui.theme.CastarroTheme
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            CastarroTheme {
                val mobileViewModel: CastarroMobileViewModel = viewModel(
                    factory = CastarroMobileViewModel.factory(application),
                )
                val lifecycleOwner = LocalLifecycleOwner.current
                DisposableEffect(lifecycleOwner, mobileViewModel) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_RESUME) {
                            mobileViewModel.refreshStreamProtection()
                        }
                    }
                    lifecycleOwner.lifecycle.addObserver(observer)
                    onDispose {
                        lifecycleOwner.lifecycle.removeObserver(observer)
                    }
                }
                val youtubeAuthorizationLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.StartIntentSenderForResult(),
                ) { result ->
                    mobileViewModel.completeYoutubeAuthorization(result.data)
                }
                val uiState = mobileViewModel.uiState.collectAsStateWithLifecycle()
                AppNavGraph(
                    uiState = uiState.value,
                    onImportVideos = mobileViewModel::importVideos,
                    onDeselectVideo = mobileViewModel::deselectVideo,
                    onMoveVideo = mobileViewModel::moveSelectedVideo,
                    onSelectChannel = mobileViewModel::selectChannel,
                    onCreateChannel = mobileViewModel::createChannel,
                    onUpdateChannel = mobileViewModel::updateChannel,
                    onRtmpServerUrlChange = mobileViewModel::updateRtmpServerUrl,
                    onStreamKeyChange = mobileViewModel::updateStreamKeyDraft,
                    onYoutubeBroadcastTitleChange = mobileViewModel::updateYoutubeBroadcastTitle,
                    onYoutubeBroadcastDescriptionChange = mobileViewModel::updateYoutubeBroadcastDescription,
                    onYoutubeThumbnailUriChange = mobileViewModel::updateYoutubeThumbnailUri,
                    onYoutubePrivacyStatusChange = mobileViewModel::updateYoutubePrivacyStatus,
                    onLoopEnabledChange = mobileViewModel::updateLoopEnabled,
                    onSaveManualProfile = mobileViewModel::saveManualProfile,
                    onConnectYoutubeAccount = {
                        mobileViewModel.connectYoutubeAccount(this) { intentSender ->
                            youtubeAuthorizationLauncher.launch(IntentSenderRequest.Builder(intentSender).build())
                        }
                    },
                    onPrepareYoutubeBroadcast = {
                        mobileViewModel.prepareYoutubeBroadcast(this) { intentSender ->
                            youtubeAuthorizationLauncher.launch(IntentSenderRequest.Builder(intentSender).build())
                        }
                    },
                    onDisconnectYoutubeAccount = {
                        mobileViewModel.disconnectYoutubeAccount(this)
                    },
                    onStartStream = mobileViewModel::startStream,
                    onStopStream = mobileViewModel::stopStream,
                    onStreamProtectionAction = { action ->
                        mobileViewModel.openStreamProtectionAction(this, action)
                    },
                    onScanSyncPairing = {
                        GmsBarcodeScanning.getClient(this)
                            .startScan()
                            .addOnSuccessListener { barcode ->
                                barcode.rawValue?.let(mobileViewModel::syncFromScannedPairingUri)
                            }
                    },
                    onToggleDesktopVideoDownload = mobileViewModel::toggleDesktopVideoDownload,
                    onStartDesktopVideoDownloads = mobileViewModel::startSelectedDesktopVideoDownloads,
                    onPauseDesktopVideoDownloads = mobileViewModel::pauseDesktopVideoDownloads,
                    onResumeDesktopVideoDownloads = mobileViewModel::resumeDesktopVideoDownloads,
                    onCancelDesktopVideoDownloads = mobileViewModel::cancelDesktopVideoDownloads,
                    onClearError = mobileViewModel::clearError,
                )
            }
        }
    }
}
