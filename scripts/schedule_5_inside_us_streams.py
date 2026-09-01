import sys
import json
import pathlib
from datetime import datetime, timedelta, timezone

sys.path.insert(0, 'scripts')
import youtube_service
from web_ui import (
    load_config_or_none,
    save_config,
    account_config_view,
    find_youtube_account,
)

ROOT = pathlib.Path(__file__).parent.parent.resolve()

FULL_YOUTUBE_ACCOUNTS = [
    {
        "id": "default",
        "label": "Default account",
        "tokens_file": ".runtime/youtube_tokens.json",
        "channel_id": "",
        "channel_title": "",
        "channel_handle": "",
        "subscriber_count": "",
        "hidden_subscriber_count": False,
        "expected_channel_name": "",
        "last_connected_at": "2026-05-25T17:41:57Z"
    },
    {
        "id": "account-1",
        "label": "Inside Us",
        "tokens_file": ".runtime/youtube_tokens_account-1.json",
        "channel_id": "UC52yHJpYHsgLYbCap7Qhh3A",
        "channel_title": "Last Historical Moments",
        "channel_handle": "@lasthistoricalmoments",
        "subscriber_count": "",
        "hidden_subscriber_count": False,
        "expected_channel_name": "",
        "last_connected_at": "2026-05-25T19:13:15Z"
    },
    {
        "id": "account-2",
        "label": "Inside Us",
        "tokens_file": ".runtime/youtube_tokens_account-2.json",
        "channel_id": "",
        "channel_title": "",
        "channel_handle": "",
        "subscriber_count": "",
        "hidden_subscriber_count": False,
        "expected_channel_name": "",
        "last_connected_at": ""
    },
    {
        "id": "account-3",
        "label": "Inside Us",
        "tokens_file": ".runtime/youtube_tokens_account-3.json",
        "channel_id": "UCnzaXJG76E3WVfXXc4t_Feg",
        "channel_title": "Inside Us",
        "channel_handle": "@officialinsideus",
        "subscriber_count": "",
        "hidden_subscriber_count": False,
        "expected_channel_name": "Inside Us",
        "last_connected_at": "2026-06-01T11:51:26Z"
    },
    {
        "id": "account-4",
        "label": "Inside Us",
        "tokens_file": ".runtime/youtube_tokens_account-4.json",
        "channel_id": "",
        "channel_title": "",
        "channel_handle": "",
        "subscriber_count": "",
        "hidden_subscriber_count": False,
        "expected_channel_name": "Inside Us",
        "last_connected_at": ""
    },
    {
        "id": "account-5",
        "label": "Inside Us",
        "tokens_file": ".runtime/youtube_tokens_account-5.json",
        "channel_id": "",
        "channel_title": "",
        "channel_handle": "",
        "subscriber_count": "",
        "hidden_subscriber_count": False,
        "expected_channel_name": "Inside Us",
        "last_connected_at": ""
    },
    {
        "id": "account-6",
        "label": "Inside Us",
        "tokens_file": ".runtime/youtube_tokens_account-6.json",
        "channel_id": "",
        "channel_title": "",
        "channel_handle": "",
        "subscriber_count": "",
        "hidden_subscriber_count": False,
        "expected_channel_name": "Inside Us",
        "last_connected_at": ""
    },
    {
        "id": "account-7",
        "label": "Inside Us Hindi",
        "tokens_file": ".runtime/youtube_tokens_account-7.json",
        "channel_id": "UCvyWtMkPiDhXbd4h5L0nFVw",
        "channel_title": "Inside Us Hindi",
        "channel_handle": "@insideushindi",
        "subscriber_count": "19",
        "hidden_subscriber_count": False,
        "expected_channel_name": "Inside Us Hindi",
        "last_connected_at": "2026-06-19T17:58:26Z"
    }
]

def run_scheduling():
    print("=== STEP 1: Setting up Inside Us channel with 5 streams ===")
    
    config_ready_path = ROOT / "config.ready.json"
    config_json_path = ROOT / "config.json"
    
    with open(config_ready_path, "r", encoding="utf-8-sig") as f:
        config_ready = json.load(f)
        
    with open(config_json_path, "r", encoding="utf-8-sig") as f:
        config_json = json.load(f)

    now = datetime.now(timezone.utc)
    
    def get_iso_times(offset_minutes, duration_minutes=120):
        st = now + timedelta(minutes=offset_minutes)
        et = st + timedelta(minutes=duration_minutes)
        return st.strftime("%Y-%m-%dT%H:%M:%SZ"), et.strftime("%Y-%m-%dT%H:%M:%SZ")

    st1, et1 = get_iso_times(15)
    st2, et2 = get_iso_times(135)
    st3, et3 = get_iso_times(255)
    st4, et4 = get_iso_times(375)
    st5, et5 = get_iso_times(495)

    streams_def = [
        {
            "id": "stream_1",
            "name": "Stream 1 - Full Human Anatomy Complete",
            "title": "🔴 Full Human Anatomy & Physiology Complete Masterclass | Inside Us",
            "description": "Welcome to Inside Us Live! Explore full human anatomy, organ systems, and body functions in this comprehensive educational stream.\n\n🔬 Topics Covered:\n- Cardiovascular, digestive, nervous, respiratory & skeletal systems\n- Organ structures and physiological processes\n- Clear 3D anatomical diagrams and visualizations\n\n🎯 Perfect for medical and nursing students, biology revision, and health science learners!\n\n#HumanAnatomy #InsideUs #AnatomyLive #MedicalEducation #Biology",
            "privacy_status": "public",
            "scheduled_start_time": st1,
            "scheduled_end_time": et1,
            "playlist": ["Go Live/Inside Us/0001-Full Human Anatomy Complete video 1hr.mp4"],
            "stream_key": "qz1f-zzpq-ucz6-s9vk-fhsg",
            "enabled": True
        },
        {
            "id": "stream_2",
            "name": "Stream 2 - Engaging Human Body Live",
            "title": "🔴 Engaging Human Body & Organ Systems Live Stream | Inside Us",
            "description": "Continuous educational live stream covering major human organ systems, cellular structures, cardiovascular health, and physiology revision.\n\n🔬 Topics Covered:\n- Human Organ Systems & Bloodstream Visualizations\n- Anatomy, Physiology & Medical Science Breakdown\n\n🎯 Perfect for students, educators, and science enthusiasts!\n\n#HumanBody #OrganSystems #Anatomy #InsideUs #BiologyLive",
            "privacy_status": "public",
            "scheduled_start_time": st2,
            "scheduled_end_time": et2,
            "playlist": ["Go Live/Inside Us/0001-Engaging live.mp4"],
            "stream_key": "rg3h-z0u6-thsu-bg9k-82sh",
            "enabled": True
        },
        {
            "id": "stream_3",
            "name": "Stream 3 - Human Ear & Hearing Physiology",
            "title": "🔴 Human Ear Anatomy & Hearing Physiology Explained | Inside Us",
            "description": "Detailed exploration of the human ear, auditory system, sound perception, and hearing mechanism.\n\n🔬 Topics Covered:\n- Outer, Middle & Inner Ear Anatomy\n- Cochlea, Tympanic Membrane & Auditory Pathway\n- How Hearing & Balance Work\n\n#HumanEar #AuditorySystem #Anatomy #InsideUs #MedicalScience",
            "privacy_status": "public",
            "scheduled_start_time": st3,
            "scheduled_end_time": et3,
            "playlist": ["Go Live/Inside Us/0001-Human Ear.mp4"],
            "stream_key": "07jb-py6t-jwcw-c7eh-6r1s",
            "enabled": True
        },
        {
            "id": "stream_4",
            "name": "Stream 4 - Anatomical Systems & Organs",
            "title": "🔴 Anatomical Systems and Organ Functions Breakdown | Inside Us",
            "description": "In-depth study session covering major human anatomical systems and organ functions with detailed animations and visualizations.\n\n🔬 Topics Covered:\n- Major Body Organs & Functional Systems\n- System Integration & Health Science\n\n#Anatomy #OrganFunctions #InsideUs #MedicalRevision #HumanBiology",
            "privacy_status": "public",
            "scheduled_start_time": st4,
            "scheduled_end_time": et4,
            "playlist": ["Go Live/Inside Us/0001-Engaging live.mp4"],
            "stream_key": "mhxz-hfyr-w5g8-wy0y-ckvd",
            "enabled": True
        },
        {
            "id": "stream_5",
            "name": "Stream 5 - Complete Human Body Masterclass",
            "title": "🔴 Complete Human Body & Medical Physiology Masterclass | Inside Us",
            "description": "Comprehensive continuous medical study stream on full human body anatomy, organs, and physiology.\n\n🔬 Topics Covered:\n- Full Human Body Overview & Organ Systems\n- Essential Physiology for Medical & Health Students\n\n#HumanBody #Physiology #InsideUs #MedicalStudents #AnatomyMasterclass",
            "privacy_status": "public",
            "scheduled_start_time": st5,
            "scheduled_end_time": et5,
            "playlist": ["Go Live/Inside Us/0001-Full Human Anatomy Complete video 1hr.mp4"],
            "stream_key": "bb40-k51r-jtcv-ff02-fche",
            "enabled": True
        }
    ]

    for cfg_data in [config_ready, config_json]:
        cfg_data["youtube"]["accounts"] = FULL_YOUTUBE_ACCOUNTS
        cfg_data["youtube"]["default_account_id"] = "account-3"
        
        channels = cfg_data.get("channels", [])
        channel_name = "Inside Us"
        target_ch = next((c for c in channels if c.get("name") == channel_name), None)
        if not target_ch:
            target_ch = {
                "name": channel_name,
                "enabled": True,
                "loop": True,
                "restart_on_exit": True,
                "youtube_auto_start": True,
                "youtube_auto_stop": True,
                "youtube_dual_stream": True,
                "raw_playlist": [
                    "Raw Videos/Inside Us/Engaging live.mp4",
                    "Raw Videos/Inside Us/Full Human Anatomy Complete video 1hr.mp4",
                    "Raw Videos/Inside Us/Human Ear.mp4"
                ],
                "playlist": [
                    "Go Live/Inside Us/0001-Engaging live.mp4",
                    "Go Live/Inside Us/0001-Full Human Anatomy Complete video 1hr.mp4",
                    "Go Live/Inside Us/0001-Human Ear.mp4"
                ]
            }
            channels.insert(0, target_ch)
        
        target_ch["youtube_account_id"] = "account-3"
        target_ch["streams"] = streams_def

    save_config("config.ready.json", config_ready)
    save_config("config.json", config_json)
    print("Base config updated and saved.")

    print("\n=== STEP 2: Creating 5 Distinct YouTube Broadcasts via YouTube API ===")
    config, _ = load_config_or_none("config.ready.json")
    acc = find_youtube_account(config, "account-3")
    token, _ = youtube_service.valid_access_token(ROOT, account_config_view(config, acc))
    
    channel = next(c for c in config["channels"] if c["name"] == "Inside Us")
    streams = channel["streams"]

    for idx, s in enumerate(streams, 1):
        print(f"\nScheduling Stream {idx}: '{s['name']}'...")
        try:
            res = youtube_service.schedule_broadcast(
                token,
                title=s["title"],
                description=s["description"],
                scheduled_start_time=s["scheduled_start_time"],
                scheduled_end_time=s["scheduled_end_time"],
                privacy_status=s["privacy_status"],
                auto_start=True,
                auto_stop=True,
                stream_key=s["stream_key"]
            )
            
            b_info = res.get("broadcast", {})
            st_info = res.get("stream", {})
            bid = b_info.get("id")
            surl = b_info.get("studio_url")
            st_id = st_info.get("id")
            
            s["youtube_broadcast_id"] = bid
            s["youtube_studio_url"] = surl
            s["youtube_stream_id"] = st_id
            print(f"  -> SUCCESS! Broadcast ID: {bid} | Studio URL: {surl}")
        except Exception as e:
            print(f"  -> ERROR scheduling stream {idx}: {e}")

    # Set channel level YouTube metadata to stream 1
    if streams:
        channel["youtube_broadcast_id"] = streams[0].get("youtube_broadcast_id", "")
        channel["youtube_studio_url"] = streams[0].get("youtube_studio_url", "")
        channel["youtube_stream_id"] = streams[0].get("youtube_stream_id", "")
        channel["youtube_broadcast_title"] = streams[0].get("title", "")

    # Sync back to config.json as well
    save_config("config.ready.json", config)
    with open(config_json_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print("\n=== STEP 3: Verifying Scheduled Streams on YouTube Studio ===")
    broadcasts = youtube_service.list_upcoming_broadcasts(token)
    print(f"Total Upcoming Broadcasts on YouTube Studio for @officialinsideus: {len(broadcasts)}")
    for i, b in enumerate(broadcasts, 1):
        bid = b.get("id")
        title = b.get("title", "").encode("ascii", "replace").decode()
        start = b.get("scheduled_start_time")
        status = b.get("life_cycle_status")
        stream_id = b.get("bound_stream_id")
        print(f" {i}. [{bid}] '{title}'\n    Start: {start} | Status: {status} | BoundStream: {stream_id}")

if __name__ == "__main__":
    run_scheduling()
