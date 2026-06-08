package com.castarro.mobile.data.youtube

import android.app.Activity
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Task

class YoutubeAuthorizationGateway(private val context: Context) {
    fun authorize(activity: Activity): Task<AuthorizationResult> =
        Identity.getAuthorizationClient(activity).authorize(
            AuthorizationRequest.builder()
                .setRequestedScopes(YOUTUBE_SCOPES)
                .build(),
        )

    fun authorizationResultFromIntent(intent: Intent?): AuthorizationResult =
        Identity.getAuthorizationClient(context).getAuthorizationResultFromIntent(intent)

    fun revoke(activity: Activity): Task<Void> =
        Identity.getAuthorizationClient(activity).revokeAccess(
            RevokeAccessRequest.builder()
                .setScopes(YOUTUBE_SCOPES)
                .build(),
        )

    companion object {
        private val YOUTUBE_SCOPES = listOf(
            Scope("https://www.googleapis.com/auth/youtube"),
            Scope("https://www.googleapis.com/auth/userinfo.profile"),
            Scope("https://www.googleapis.com/auth/userinfo.email"),
        )
    }
}
