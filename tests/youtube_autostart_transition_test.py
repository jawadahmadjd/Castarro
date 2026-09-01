#!/usr/bin/env python3
"""
Unit tests for YouTube auto-start, stream key matching, and live transition logic.
"""
import unittest
from unittest.mock import patch, MagicMock
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import youtube_service
import web_ui


class TestYouTubeAutoStartTransition(unittest.TestCase):

    @patch("youtube_service.list_mine_live_streams")
    @patch("youtube_service.list_upcoming_broadcasts")
    def test_find_stream_and_broadcast_by_key(self, mock_upcoming, mock_streams):
        mock_streams.return_value = [
            {
                "id": "stream_yt_123",
                "cdn": {"ingestionInfo": {"streamName": "test-key-abc-123"}},
                "status": {"streamStatus": "active"},
            },
            {
                "id": "stream_yt_456",
                "cdn": {"ingestionInfo": {"streamName": "other-key-xyz-789"}},
                "status": {"streamStatus": "inactive"},
            },
        ]
        mock_upcoming.return_value = [
            {
                "id": "broadcast_yt_999",
                "bound_stream_id": "stream_yt_123",
                "title": "My Stream #1",
                "auto_start": True,
            }
        ]

        # 1. Matching stream key
        result = youtube_service.find_stream_and_broadcast_by_key("dummy_token", "test-key-abc-123")
        self.assertEqual(result["stream_id"], "stream_yt_123")
        self.assertEqual(result["broadcast_id"], "broadcast_yt_999")
        self.assertTrue(result["auto_start_enabled"])
        self.assertIn("broadcast_yt_999", result["studio_url"])

        # 2. Non-matching stream key
        result_none = youtube_service.find_stream_and_broadcast_by_key("dummy_token", "non-existent-key")
        self.assertEqual(result_none["stream_id"], "")
        self.assertEqual(result_none["broadcast_id"], "")

    @patch("youtube_service.youtube_get")
    @patch("youtube_service.request_json")
    def test_update_broadcast_auto_start(self, mock_put, mock_get):
        mock_get.return_value = {
            "items": [
                {
                    "id": "b_123",
                    "snippet": {"title": "Live Stream", "description": "Desc", "scheduledStartTime": "2026-09-01T12:00:00Z"},
                    "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
                    "contentDetails": {"enableAutoStart": False, "enableAutoStop": False},
                }
            ]
        }
        mock_put.return_value = {"id": "b_123", "contentDetails": {"enableAutoStart": True, "enableAutoStop": True}}

        updated = youtube_service.update_broadcast_auto_start("dummy_token", "b_123", auto_start=True, auto_stop=True)
        self.assertTrue(mock_put.called)
        call_kwargs = mock_put.call_args[1]
        self.assertEqual(call_kwargs["body"]["contentDetails"]["enableAutoStart"], True)
        self.assertEqual(call_kwargs["body"]["contentDetails"]["enableAutoStop"], True)

    @patch("youtube_service.update_broadcast_auto_start")
    @patch("youtube_service.broadcast_chat_details_by_id")
    @patch("youtube_service.live_stream_by_id")
    @patch("youtube_service.transition_broadcast_status")
    def test_ensure_stream_transition_to_live(self, mock_transition, mock_stream, mock_broadcast, mock_update_auto):
        # Broadcast starts in 'ready', stream becomes 'active', transition is called
        mock_broadcast.side_effect = [
            {"life_cycle_status": "ready"},
            {"life_cycle_status": "ready"},
            {"life_cycle_status": "live"},
        ]
        mock_stream.return_value = {"status": {"streamStatus": "active"}}
        mock_transition.return_value = {"status": {"lifeCycleStatus": "live"}}

        res = youtube_service.ensure_stream_transition_to_live(
            "dummy_token",
            stream_id="stream_yt_123",
            broadcast_id="b_123",
            max_wait_seconds=5.0,
            poll_interval=0.1,
        )
        self.assertTrue(res["is_live"])
        self.assertEqual(res["status"], "live")
        self.assertTrue(mock_transition.called)


if __name__ == "__main__":
    unittest.main()
