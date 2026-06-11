#!/usr/bin/env python3
"""Smoke-test cloud copy-mode compatibility decisions."""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import cloud_probe  # noqa: E402


READY_PAYLOAD = {
    "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "60.000000"},
    "streams": [
        {
            "codec_type": "video",
            "codec_name": "h264",
            "width": 1920,
            "height": 1080,
            "avg_frame_rate": "30/1",
            "pix_fmt": "yuv420p",
        },
        {
            "codec_type": "audio",
            "codec_name": "aac",
            "sample_rate": "48000",
            "channels": 2,
        },
    ],
}


def main() -> int:
    ready = cloud_probe.report_from_ffprobe_payload(
        READY_PAYLOAD,
        display_name="ready.mp4",
        source_uri="castarro://cloud/google-drive-main/ready",
        size_bytes=1234,
        range_readable=True,
    )
    assert ready["compatibilityStatus"] == "ready", ready
    assert ready["fps"] == 30, ready

    blocked = cloud_probe.report_from_ffprobe_payload(
        {
            **READY_PAYLOAD,
            "streams": [
                {**READY_PAYLOAD["streams"][0], "codec_name": "hevc"},
                READY_PAYLOAD["streams"][1],
            ],
        },
        display_name="hevc.mp4",
        source_uri="castarro://cloud/google-drive-main/hevc",
        size_bytes=1234,
        range_readable=True,
    )
    assert blocked["compatibilityStatus"] == "needsDesktopPrep", blocked

    no_range = cloud_probe.report_from_ffprobe_payload(
        READY_PAYLOAD,
        display_name="no-range.mp4",
        source_uri="castarro://cloud/google-drive-main/no-range",
        size_bytes=1234,
        range_readable=False,
    )
    assert no_range["compatibilityStatus"] == "blocked", no_range

    playlist = cloud_probe.playlist_compatibility([ready, {**ready, "width": 1280}])
    assert playlist["compatibilityStatus"] == "blocked", playlist
    assert "mixes incompatible" in playlist["compatibilityMessage"], playlist

    print("cloud_probe_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
