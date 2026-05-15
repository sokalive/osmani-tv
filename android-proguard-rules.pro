# Osmani TV - R8/ProGuard (AGP 8 / Gradle 8, Expo SDK 54)
# Loaded as string content via app.config.js -> expo-build-properties extraProguardRules

# --- React Native / Hermes ---
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}
-keepclassmembers @com.facebook.proguard.annotations.KeepGettersAndSetters class * {
    void set*(***);
    *** get*();
}
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.bridge.** { *; }

# --- Expo modules + Osmani native modules ---
-keep @com.facebook.react.bridge.ReactMethod class *
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-keep class expo.modules.** { *; }
-keep class com.osmantv.update.** { *; }
-keep class com.osmantv.security.** { *; }

# --- Reanimated ---
-keep class com.swmansion.reanimated.** { *; }

# --- react-native-webview ---
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.reactnativecommunity.webview.** { *; }

# --- expo-av / Media3 ---
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**
-keep class expo.modules.av.** { *; }
-dontwarn com.google.android.exoplayer2.**

# --- OneSignal ---
-keep class com.onesignal.** { *; }
-dontwarn com.onesignal.**

# --- Networking (fetch, SSE, payments) ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**

# --- Common R8 / JDK optional types ---
-dontwarn java.beans.**
-dontwarn javax.xml.bind.**
-dontwarn com.google.gson.**

# --- Annotations / generics used by JSON/reflection ---
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,RuntimeVisibleParameterAnnotations

# --- WebView callbacks (embed + hls bridges) ---
-keepclassmembers class * extends android.webkit.WebViewClient {
    <methods>;
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    <methods>;
}
