import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing: keystore.properties in the project root (git-ignored; storeFile, storePassword, keyAlias,
// keyPassword). Without it, release builds fall back to the debug key, as in the prototype. See README.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}
val hasReleaseKey = keystoreProps.getProperty("storeFile")?.let { file(it).isFile } == true

android {
    namespace = "com.weblauncher.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.weblauncher.tv"
        minSdk = 24
        targetSdk = 34
        versionCode = 6
        versionName = "1.1.1"
    }

    signingConfigs {
        if (hasReleaseKey) create("release") {
            storeFile = file(keystoreProps.getProperty("storeFile"))
            storePassword = keystoreProps.getProperty("storePassword")
            keyAlias = keystoreProps.getProperty("keyAlias")
            keyPassword = keystoreProps.getProperty("keyPassword")
        }
    }

    buildTypes {
        // Same key as release, so debug and release builds replace each other on the TV without an uninstall.
        debug { if (hasReleaseKey) signingConfig = signingConfigs.getByName("release") }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName(if (hasReleaseKey) "release" else "debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

// Unit tests only (nothing ships): RuntimeGuard.jankPerInput must match tools/lib/bench.mjs.
dependencies {
    // ProxyController (R23): the WebView gets a dead proxy, so nothing in a page (a skin's <link rel=preconnect>
    // included) can open a connection. The app's own downloads (SkinInstaller) don't use the WebView.
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
}
