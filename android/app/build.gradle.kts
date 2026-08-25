plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("kotlin-kapt")
}

android {
    namespace = "com.ente.gallery"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.ente.gallery"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // DO NOT put SERVICE_ROLE here. See SECURITY.md
        buildConfigField("String", "SUPABASE_URL", "\"${project.findProperty("supabaseUrl") ?: ""}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${project.findProperty("supabaseAnonKey") ?: ""}\"")
        buildConfigField("String", "FACE_THRESHOLD", "\"${project.findProperty("faceThreshold") ?: "0.28"}\"")
        buildConfigField("String", "FACE_MARGIN", "\"${project.findProperty("faceMargin") ?: "0.06"}\"")
        buildConfigField("String", "FACE_FLOOR", "\"${project.findProperty("faceFloor") ?: "0.20"}\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    androidResources { generateLocaleConfig = false }
}

dependencies {
    // Core
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")

    // Networking
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Supabase Kotlin (postgrest + gotrue)
    implementation("io.github.jan-tennert.supabase:postgrest-kt:3.0.3")
    implementation("io.github.jan-tennert.supabase:gotrue-kt:3.0.3")
    implementation("io.github.jan-tennert.supabase:realtime-kt:3.0.3")

    // ONNX Runtime Android — 200MB+ model path, NNAPI + XNNPACK
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")

    // Image
    implementation("com.github.bumptech.glide:glide:4.16.0")
    kapt("com.github.bumptech.glide:compiler:4.16.0")

    // JSON
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
