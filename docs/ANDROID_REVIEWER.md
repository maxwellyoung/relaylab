# Native Android reviewer

`android/` is an Android Studio project using Java, native Android views and
WorkManager. It calls the coordinator's existing review HTTP API; the
coordinator calls the independent gRPC runner. No WebView, Firebase account,
cloud notification service or API key is needed for this local demo.

## Build and run

Prerequisites: Android Studio / Android SDK platform 35, build tools 34.0.0,
and JDK 17 or 21. The checked-in Gradle 8.7 wrapper verifies its distribution
checksum; Android Gradle Plugin 8.6.1 and the dependency lock pin this build.
Use the existing root npm lockfile for the services and install the .NET SDK
pinned in `global.json` for the group coordinator. See
[.NET coordinator setup](DOTNET_COORDINATOR.md).

```bash
npm ci
npm run build:group
PORT=3118 RUNNER_PORT=50118 npm run start:group
```

Open http://localhost:3118 in a researcher browser tab. Import the repository's
`android/` directory in Android Studio and run `app` on an emulator. Or build:

```bash
# Set ANDROID_HOME to your own installed SDK if local.properties is absent.
./android/gradlew -p android :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. In the app,
connect to **http://10.0.2.2:3118** (Android emulator alias for the host). A
physical device is not covered by this emulator setup or verification. Debug
cleartext is permitted only to 10.0.2.2, 127.0.0.1 and localhost; all other
origins require HTTPS. The release manifest permits HTTPS only and excludes
the debug test receiver. Release output is unsigned and is not a store release.

## Connected workflow

1. As Researcher A in the web client, execute an experiment and submit the run.
2. Refresh the Android queue, open the pending review, and inspect execution
   evidence. Approval is independent of execution outcome.
3. Enter feedback, then approve or reject. The API atomically permits one
   pending-to-final decision. A stale 409 refreshes the winning decision.
4. Refresh the researcher's web reviews to read the Android decision/feedback.

Each Android network job obtains and revokes a short-lived **demo reviewer**
session. Tokens are not stored, backed up or logged. New jobs reconnect after
coordinator restart/expiry. Account selection is open to anyone, so this is a
workflow prototype rather than password authentication. The legacy experiment
lab remains shared; researcher experiment ownership is not established.

The model survives rotation with the selected review, feedback draft and
in-flight decision. Process recreation reloads the persisted queue; saved
instance state retains the selected ID/draft when Android supplies it. Drafts
are not persisted across force-stop or dismissal of the task. An offline
queue is labelled as last retrieved; decisions remain disabled after an
uncertain request until a successful refresh confirms current state. Network
work runs away from the UI thread with bounded connect/read times and response
size. Changing API/disconnecting clears private rows and notification state.

## Notifications and timing

Notification opt-in requests Android 13+ POST_NOTIFICATIONS permission.
Denial leaves the review queue usable; Android settings can also block alerts.
The first successful snapshot after opt-in establishes a baseline. A later
successful snapshot posts one private system notification for each new pending
review ID. Existing backlog and repeated snapshots do not alert. Tapping an
alert opens that review; the activity refreshes evidence from the API.

Foreground checks run every 10 seconds while the activity is resumed. A unique
WorkManager periodic job starts after 15 minutes and continues at that interval
or later, subject to connectivity, battery policy, Doze and OS scheduling.
**These are polled local notifications, not instant remote push.** The computer
hosting the local API must be reachable. The explicit “Check notifications now”
control requests the same worker immediately. Disable cancels periodic/one-time
work and posted notifications; late results recheck opt-in, API origin and the current opt-in generation.

Scheduling the periodic lane with an initial delay separates it from the
immediate opt-in baseline check. This also avoids overlapping initial periodic
and one-time jobs. Failed polls do not advance the notification baseline.

See the primary [periodic-work reference](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest)
and [notification-permission guide](https://developer.android.com/develop/ui/views/notifications/notification-permission)
for the OS constraints.

## Reproducible emulator checkpoint

The smoke script accepts only an explicit emulator serial whose AVD name is
**RelayLabReviewerQA**, and only the local port-3118 or port-3128 group API. It resets this
app's data on that dedicated AVD and creates synthetic review evidence. It
refuses physical serials and writes raw proof only under ignored `outputs/`.
The installed debug APK must match the current source.

```bash
python3 scripts/smoke-android.py --serial emulator-5570
```

The debug-only `DebugPollReceiver`, protected by Android's shell DUMP permission,
enqueues the real worker while the activity is backgrounded. The worker fetches
the real API and performs the normal new-ID comparison; the test never directly
constructs a notification. Release manifest verification confirms the receiver
is absent. This makes background integration repeatable without waiting for an
inexact 15-minute schedule; it does not measure natural background delivery time.

On 8 October 2026, the API-36 emulator checkpoint passed: permission denial,
required feedback, rotation/draft retention, native approval and rejection with
researcher feedback, notification baseline, background worker delivery and
notification tap, process recreation, API-loss labelling, system Back and notification disable and stale competing
decision recovery. The researcher browser also displayed the native approval.
The same build passed five unit tests and debug/release builds and lint (two
version-update warnings remain). The complete existing npm verification passed
103 tests with one credential-dependent live MySQL skip, all types/builds,
three integration smokes and zero production npm audit vulnerabilities.

Private proof is in `outputs/android-reviewer-2026-10-08/`. GitHub CI separately
checks Node verification, a real disposable MySQL adapter and Android
unit/build/lint tasks on branch pushes. Local emulator success is not physical
hardware proof, CI success, production authentication, a measured large-data
performance result, teammate agreement or three weeks of new development.

## Reviewer interface revision, 8 October

The reviewer now starts with one next run and a quieter waiting list. **History**
contains completed decisions and their feedback; **Settings** holds API and
notification controls. A selected receipt keeps execution outcome separate from
its review decision. Large raw evidence is scrollable within a bounded panel.
The web counterpart uses a focused list/detail workspace with a phone back path.

Foreground refresh no longer replaces an active feedback editor when another
run arrives. Drafts stay editable during API loss, while a successful refresh
is required before an uncertain decision can be attempted again. The native
smoke now includes this queue-arrival/focus case and follows the Settings and
History navigation. New visual/runtime proof is kept outside version control.

## .NET compatibility checkpoint, 10 October

The unchanged debug APK passed all ten native smoke scenarios against the
ASP.NET coordinator on port 3128: approval/rejection and researcher feedback,
validation, focus/draft continuity during queue arrivals, rotation, permissions,
notification baseline, actual background worker and notification tap, process
recreation, disable and competing-decision recovery. This used the dedicated
API-36 emulator and synthetic data. Natural periodic delivery timing and physical
hardware remain unverified.

```bash
PORT=3128 RUNNER_PORT=50128 npm run start:group
python3 scripts/smoke-android.py --serial emulator-5570 --api http://127.0.0.1:3128 --output outputs/dotnet-android
```

The smoke switches the emulator app to `http://10.0.2.2:3128` through Settings
after clearing only the dedicated QA app. Local proof is ignored under
`outputs/dotnet-transition-2026-10-10/android/`.


## EF persistence checkpoint, 11 October

The unchanged debug APK passed the same ten dedicated API-36 emulator scenarios
against the EF-backed coordinator. The preview health reported
`persistenceAdapter: "ef"`; prior preview records were retained before the
new synthetic checks. Native approval/rejection and researcher feedback,
notifications, draft/rotation continuity and stale-decision recovery passed.
The browser separately completed submission, approval and feedback against EF.
Private proof is ignored under `outputs/ef-integration-2026-10-11/`.
