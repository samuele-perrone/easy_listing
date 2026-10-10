"""Lists the most recent TestFlight builds straight from the App Store Connect API.

    python3 -m venv /tmp/ascvenv && /tmp/ascvenv/bin/pip install pyjwt cryptography
    /tmp/ascvenv/bin/python ios/asc_builds.py <issuer-id>


altool prints UPLOAD SUCCEEDED and exits 0 even when Apple returned a 500 and
the build never registered (seen twice on 29 Sep 2026), so the API is the only
trustworthy confirmation that a build actually arrived.
"""

import json
import sys
import time
import urllib.error
import urllib.request

import jwt

KEY_ID = "5LGP386KP6"
# Passed in, never stored here: the issuer id is a credential and the repo is
# not the place for it. App Store Connect → Users and Access → Integrations →
# Team Keys; it is the "Issuer ID" row above the table of keys.
ISSUER_ID = sys.argv[1]
BUNDLE_ID = "com.samperrone.easylisting"
KEY_PATH = f"/Users/sam/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8"


def token() -> str:
    with open(KEY_PATH) as handle:
        private_key = handle.read()
    now = int(time.time())
    return jwt.encode(
        {"iss": ISSUER_ID, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
        private_key,
        algorithm="ES256",
        headers={"kid": KEY_ID, "typ": "JWT"},
    )


def get(path: str) -> dict:
    request = urllib.request.Request(
        f"https://api.appstoreconnect.apple.com/v1/{path}",
        headers={"Authorization": f"Bearer {token()}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code}: {error.read().decode()[:400]}")
        sys.exit(1)


apps = get(f"apps?filter[bundleId]={BUNDLE_ID}")
if not apps.get("data"):
    print(f"No app found for {BUNDLE_ID}")
    sys.exit(1)

app = apps["data"][0]
app_id = app["id"]
print(f"app: {app['attributes'].get('name')}  (id {app_id})\n")

builds = get(f"builds?filter[app]={app_id}&limit=8&sort=-uploadedDate")
rows = builds.get("data", [])
if not rows:
    print("No builds registered at all.")
    sys.exit(0)

print(f"{'build':>6}  {'version':>8}  {'state':<22}  uploaded")
for build in rows:
    a = build["attributes"]
    print(
        f"{a.get('version',''):>6}  {a.get('preReleaseVersion') or '':>8}  "
        f"{str(a.get('processingState')):<22}  {a.get('uploadedDate')}"
    )
