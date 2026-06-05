# Castarro Shared Core

`shared/castarro-core` contains Castarro contracts that must stay consistent across desktop and mobile while still allowing each platform to keep its own UI and runtime implementation.

## Shared Feature Rule

Shared features are described here before platform UI work starts. Desktop and Android may render the feature differently, but they should validate the same data examples and use the same user-facing readiness/status language.

Keep shared:

- Channel, video asset, stream profile, compatibility report, YouTube profile, and stream session shapes.
- Copy-mode compatibility statuses and blocking messages.
- Stream status names and error categories.
- Design colors, radius, spacing, typography, and status tones.
- Feature scope metadata.
- Fixture examples used by desktop and Android tests.

Keep separate:

- Desktop layout and Electron shell behavior.
- Android Compose layout, Storage Access Framework behavior, foreground notifications, and service supervision.
- Platform-specific FFmpeg process/native-library wiring.

## Contract Workflow

1. Update schemas, fixtures, or feature flags here first.
2. Run the desktop-side validation script.
3. Add or update Android fixture tests when the Android project consumes the same examples.
4. Capture separate acceptance screenshots for desktop and mobile UI changes.

This folder intentionally uses JSON contracts so Python, JavaScript, Kotlin, and future platform code can consume the same source of truth.
