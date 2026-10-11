# EM Sim for Android

The Android app opens the live simulator (https://emsimulator.com) as a Trusted Web Activity.
It runs in the phone's or tablet's Chrome engine, full screen, with its own icon. Because the site does all
the work, simulator changes reach the app straight away and the app never needs a new release for them.

Everything the website does works the same way in the app:

- Google and email sign-in, which works because it runs in Chrome and not in a bare WebView.
- The controller, monitor, defib and ventilator screens on separate devices.
- Sound.
- Full screen.

If the device has no browser that supports Trusted Web Activities, the app opens the site in a Chrome Custom
Tab instead.

## Get a test APK

GitHub, Actions, **Android app**, the latest run, then the **em-sim-debug-apk** artifact. Unzip it and
install `app-debug.apk`. On the phone, allow installs from that source.

A test install shows a thin address bar at the top. The bar goes away once the site's
`/.well-known/assetlinks.json` lists the app's signing key (see below).

## Build locally

You need the Android SDK (platform 36) and JDK 17 or later.

```
cd android
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

## Publishing on Google Play (Jake to do)

1. **Create a Google Play developer account.** This is a one-off fee, at play.google.com/console.
2. **Make an upload key** and keep it safe, outside the repository:
   ```
   keytool -genkeypair -v -keystore em-sim-upload.jks -alias em-sim -keyalg RSA -keysize 2048 -validity 10000
   ```
3. **Add four repository secrets** in GitHub (Settings, Secrets and variables, Actions):
   - `SIM_KEYSTORE_BASE64`: the output of `base64 -w0 em-sim-upload.jks`
   - `SIM_KEYSTORE_PASSWORD`
   - `SIM_KEY_ALIAS` (`em-sim`)
   - `SIM_KEY_PASSWORD`
4. **Build the signed bundle.** Run the **Android app** action. The **em-sim-release** artifact holds the signed
   `app-release.aab`.
5. **Create the app in Play Console and upload the bundle.** Use Play App Signing, which is the default.
   Then fill in the store listing, the content rating, the data safety form and the privacy policy link.
6. **Remove the address bar.** In Play Console, go to App integrity, App signing, and copy the **app signing key
   SHA-256** fingerprint.
   - Add it to `sha256_cert_fingerprints` in `/.well-known/assetlinks.json` at the repository root, then deploy
     the site.
   - For sideloaded test builds signed with your upload key, also add the upload key's SHA-256:
     `keytool -list -v -keystore em-sim-upload.jks`.
7. **Bump the version for each new release.** Raise `versionCode` (and `versionName`) in `app/build.gradle.kts`.

## Notes

- **Package:** `org.emevidence.sim`. Once it is published on Play it cannot change.
- **Links:** the app also opens https://emsimulator.com links, such as a monitor or ventilator join link.
- **Colours** come from the site's `manifest.json` (#0f172a) and the icon from `defib/images/icon-512.png`.
