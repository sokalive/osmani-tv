# Osmani TV — release R8/ProGuard keep rules (expo-av, WebView bridges, payments, SSE).

# React Native / Hermes
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

# Expo modules core + Kotlin modules
-keep class expo.modules.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keepclassmembers class * {
  @expo.modules.kotlin.functions.AsyncFunction *;
}
-keep class com.osmantv.update.** { *; }
-keep class com.osmantv.security.** { *; }

# expo-av / ExoPlayer
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**
-keep class com.google.android.exoplayer2.** { *; }
-dontwarn com.google.android.exoplayer2.**
-keep class expo.modules.av.** { *; }

# react-native-webview — JS bridge + @JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.reactnativecommunity.webview.** { *; }
-keep class com.reactnativecommunity.webview.RNCWebViewManager { *; }
-keep class com.reactnativecommunity.webview.RNCWebViewModule { *; }

# OneSignal
-keep class com.onesignal.** { *; }
-dontwarn com.onesignal.**

# OkHttp / SSE (react-native-sse, fetch)
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses

# JSON / reflection used by payment + API payloads
-keepclassmembers class * {
  @com.google.gson.annotations.SerializedName <fields>;
}
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations

# Android components
-keep class * extends android.app.Activity { *; }
-keep class * extends android.app.Service { *; }
-keep class * extends android.content.BroadcastReceiver { *; }

# Prevent stripping WebViewClient callbacks used by embed/hls bridges
-keepclassmembers class * extends android.webkit.WebViewClient {
    public void on*(...);
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public void on*(...);
}
