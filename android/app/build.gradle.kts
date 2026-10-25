// EM Evidence Sim as an Android app: a Trusted Web Activity that opens https://emsimulator.com in the
// phone's or tablet's Chrome (or another browser that supports TWAs), full screen, with no browser bar
// once the site's /.well-known/assetlinks.json lists this app's signing key (see android/README.md).
// The site does all the work, so the app never needs updating for simulator changes.
import java.util.Base64

plugins { id("com.android.application") }

// Release signing comes from the environment (the GitHub Action's secrets); without it the release
// build is left unsigned and only the debug APK is installable.
val ksB64: String? = System.getenv("SIM_KEYSTORE_BASE64")
val ksFile = layout.buildDirectory.file("upload.jks").get().asFile
if (!ksB64.isNullOrBlank()) { ksFile.parentFile.mkdirs(); ksFile.writeBytes(Base64.getMimeDecoder().decode(ksB64)) }

android {
    namespace = "org.emevidence.sim"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.emevidence.sim"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        // The site the app opens, and the colours of the splash, status bar and navigation bar
        // (from the site's manifest.json: background #0f172a, theme #0ea5e9).
        manifestPlaceholders["hostName"] = "emsimulator.com"
        manifestPlaceholders["defaultUrl"] = "https://emsimulator.com/"
    }

    signingConfigs {
        if (!ksB64.isNullOrBlank()) create("upload") {
            storeFile = ksFile
            storePassword = System.getenv("SIM_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("SIM_KEY_ALIAS")
            keyPassword = System.getenv("SIM_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (!ksB64.isNullOrBlank()) signingConfig = signingConfigs.getByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.6.0") // 2.7.4 builds would not open on a Samsung S25+ (Oct 2026); 2.6.0, as in the major incident app, does
}
