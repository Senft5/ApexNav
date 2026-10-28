# TestFlight: automatic uploads from CI

Every push to `main` that runs the iOS workflow (`.github/workflows/build.yml`; docs-only merges skip it) and every
manual run of that workflow on `main` archives the app, signs it and uploads it to App Store Connect. The build shows
in TestFlight after Apple's processing, usually 5 to 30 minutes.

- **Signing:** automatic, through an App Store Connect API key (`xcodebuild -allowProvisioningUpdates`). Xcode creates
  the distribution certificate and profile in Apple's cloud. Nothing is stored in the repo.
- **Build number:** `CFBundleVersion` = `<workflow run number>.<attempt>` (always goes up; a re-run gets a new one).
  The version people see is `MARKETING_VERSION` in `project.yml` (1.0); raise it there for each App Store release.
- **Gate:** the job `testflight-gate` checks the four secrets. While any is missing, `testflight` is skipped and the run
  summary says which secrets are missing. The upload waits for `apexkit-macos` and `simulator-tests` to pass.
- **Unchanged:** `build-ipa` still builds the unsigned sideload `ApexNav-IPA` artifact.
- **Export compliance:** `ITSAppUsesNonExemptEncryption = NO` (HTTPS only), so builds don't wait on the question.
- **Xcode 26:** App Store Connect refuses builds made with an iOS SDK older than 26, so `testflight` runs on
  `macos-26` and checks the SDK before archiving. The other macOS jobs stay on `macos-15`.
- **iPhone only** (`TARGETED_DEVICE_FAMILY = 1`): an iPad build would have to support every orientation.

## One-time setup (owner)

1. Apple Developer Program membership active: https://developer.apple.com/account (the Membership page shows the
   **Team ID**, 10 characters).
2. Register the bundle ID **`com.senft.ApexNav`** (explicit App ID, no extra capabilities needed):
   https://developer.apple.com/account/resources/identifiers/add/bundleId
3. Create the app record: https://appstoreconnect.apple.com/apps, **+**, New App. Platform iOS, name (e.g. "Apex Nav";
   the name must be unique on the App Store), primary language, bundle ID `com.senft.ApexNav`, SKU e.g. `apexnav`,
   User Access: Full Access.
4. Create an API key: https://appstoreconnect.apple.com/access/integrations/api (request access the first time),
   **Generate API Key**, role **Admin** (App Manager can't create the cloud distribution certificate). Note the
   **Key ID** and the **Issuer ID** above the list, and download `AuthKey_<KeyID>.p8` (only downloadable once).
5. Add four repository secrets: https://github.com/Senft5/ApexNav/settings/secrets/actions
   - `ASC_KEY_ID`: the Key ID
   - `ASC_ISSUER_ID`: the Issuer ID
   - `ASC_KEY_P8`: the whole `.p8` file contents, including the BEGIN/END lines (base64 of the file also works)
   - `APPLE_TEAM_ID`: the Team ID
6. Run it: https://github.com/Senft5/ApexNav/actions/workflows/build.yml, Run workflow on `main` (or merge anything).
7. Testers: App Store Connect, the app, TestFlight. Internal testers (up to 100 people on the team) get builds right
   away; an external group needs one Beta App Review per version.

## If an upload fails

- "No Accounts" / "No signing certificate": the API key isn't Admin, or the membership isn't active yet.
- "No suitable application records were found": step 3 not done, or the bundle ID differs.
- "The bundle version must be higher": a build number was used already; re-run the workflow (new attempt number).
- "Error Downloading App Information" at export: App Store Connect has no app record for `com.senft.ApexNav` that the
  key can see (step 3 missing, a different bundle ID, or a key without Admin). The "Show the distribution log" step
  prints Apple's actual reply.
