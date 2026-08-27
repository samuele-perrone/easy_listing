#!/bin/bash
# Archives Easy Listing and uploads it to TestFlight.
#
# One-time setup:
#   1. Join the Apple Developer Program and create the app in App Store Connect
#      with bundle ID com.samperrone.easylisting
#   2. App Store Connect → Users and Access → Integrations → App Store Connect API
#      → generate a key. Note the Key ID and Issuer ID, download the .p8 once.
#   3. mkdir -p ~/.appstoreconnect/private_keys && mv ~/Downloads/AuthKey_*.p8 "$_"
#   4. export ASC_KEY_ID=... ASC_ISSUER_ID=...
#
# Each release: bump the build number, then run ./release.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${ASC_KEY_ID:?set ASC_KEY_ID (App Store Connect API key id)}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID (App Store Connect issuer id)}"

ARCHIVE="build/EasyListing.xcarchive"
EXPORT_DIR="build/export"

echo "==> Regenerating project"
xcodegen generate

echo "==> Archiving"
xcodebuild -project EasyListing.xcodeproj -scheme EasyListing \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates archive

echo "==> Exporting"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist ExportOptions.plist -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

echo "==> Uploading to TestFlight"
xcrun altool --upload-app -f "$EXPORT_DIR"/*.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo "==> Done. Processing takes ~5-15 minutes before it appears in TestFlight."
