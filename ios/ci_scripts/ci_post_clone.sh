#!/bin/sh
# Xcode Cloud runs this after cloning, before resolving the project.
# EasyListing.xcodeproj isn't committed — XcodeGen generates it from project.yml —
# so it has to be created here or the build has nothing to build.
set -e

brew install xcodegen

cd "$CI_PRIMARY_REPOSITORY_PATH/ios"

# project.yml pins CURRENT_PROJECT_VERSION, so every cloud build would upload as
# build 1 and App Store Connect rejects duplicates. Use the number Xcode Cloud
# assigns instead, which increments per build.
if [ -n "$CI_BUILD_NUMBER" ]; then
  sed -i '' "s/CURRENT_PROJECT_VERSION: \"[^\"]*\"/CURRENT_PROJECT_VERSION: \"$CI_BUILD_NUMBER\"/" project.yml
  echo "Build number set to $CI_BUILD_NUMBER"
fi

xcodegen generate

echo "Generated EasyListing.xcodeproj"
