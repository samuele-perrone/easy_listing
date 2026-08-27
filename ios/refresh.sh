#!/bin/bash
# Rebuilds Easy Listing and reinstalls it, refreshing the 7-day free-signing
# certificate. Safe to run any time — reinstalling keeps the app's data, since
# history lives in SwiftData on the device.
#
# Needs the iPhone connected (or on the same network) and UNLOCKED: iOS refuses
# to mount the developer disk image on a locked device.
#
# Run it manually, or schedule it (see the bottom of this file).
set -euo pipefail
cd "$(dirname "$0")"

DEVICE="${EASYLISTING_DEVICE:-FC3F9E66-E153-5592-80EF-415D6B4909EA}"
APP="$PWD/build/Build/Products/Debug-iphoneos/EasyListing.app"

echo "==> Building"
xcodegen generate >/dev/null
xcodebuild -project EasyListing.xcodeproj -scheme EasyListing \
  -destination 'generic/platform=iOS' -derivedDataPath ./build \
  -allowProvisioningUpdates build >/dev/null

echo "==> Installing (waiting for the phone to be unlocked)"
for attempt in $(seq 1 60); do
  if out=$(xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1); then
    echo "==> Installed on attempt $attempt"
    exit 0
  fi
  if ! grep -q "DeviceLocked" <<<"$out"; then
    echo "==> Install failed:"; tail -5 <<<"$out"; exit 1
  fi
  sleep 30
done

echo "==> Gave up: the phone stayed locked for 30 minutes."
exit 1

# To run this automatically every few days, install a launchd agent:
#
#   cat > ~/Library/LaunchAgents/com.samperrone.easylisting.refresh.plist <<'PLIST'
#   <?xml version="1.0" encoding="UTF-8"?>
#   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
#   <plist version="1.0"><dict>
#     <key>Label</key><string>com.samperrone.easylisting.refresh</string>
#     <key>ProgramArguments</key>
#     <array><string>/Users/sam/Sites/easy_listing/ios/refresh.sh</string></array>
#     <key>StartCalendarInterval</key>
#     <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer></dict>
#     <key>StandardOutPath</key><string>/tmp/easylisting-refresh.log</string>
#     <key>StandardErrorPath</key><string>/tmp/easylisting-refresh.log</string>
#   </dict></plist>
#   PLIST
#   launchctl load ~/Library/LaunchAgents/com.samperrone.easylisting.refresh.plist
#
# That runs every Monday at 9am. Remove it with `launchctl unload` on the same path.
