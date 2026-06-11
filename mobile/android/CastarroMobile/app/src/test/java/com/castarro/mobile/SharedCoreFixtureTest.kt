package com.castarro.mobile

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SharedCoreFixtureTest {
    @Test
    fun sharedCoreFixturesArePresentForAndroidConsumption() {
        val root = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
            .map { File(it, "shared/castarro-core") }
            .first { it.exists() }
        assertTrue(File(root, "fixtures/compatibility/ready-h264-aac-1080p30.json").exists())
        assertTrue(File(root, "fixtures/cloud-video-assets/ready-google-drive-h264-aac.json").exists())
        assertTrue(File(root, "fixtures/cloud-video-assets/blocked-google-drive-hevc.json").exists())
        assertTrue(File(root, "schemas/storage-provider.schema.json").exists())
        assertTrue(File(root, "schemas/cloud-video-asset.schema.json").exists())
        assertTrue(File(root, "feature-flags/features.json").exists())
    }
}
