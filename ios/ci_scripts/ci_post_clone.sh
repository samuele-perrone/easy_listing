#!/bin/sh
# Xcode Cloud runs this after cloning, before resolving the project.
# EasyListing.xcodeproj isn't committed — XcodeGen generates it from project.yml —
# so it has to be created here or the build has nothing to build.
set -e

brew install xcodegen

cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
xcodegen generate

echo "Generated EasyListing.xcodeproj"
