package com.osmantv.security

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Debug
import java.io.BufferedReader
import java.io.File
import java.io.FileInputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest

/**
 * Best-effort runtime checks for SAFE MODE risk scoring.
 * Never throws — callers receive empty signals on failure.
 */
object SecurityAuditor {

    data class Signal(val riskType: String, val riskScore: Int, val detail: String)

    fun audit(context: Context, expectedCertSha256: String?): AuditPayload {
        val signals = mutableListOf<Signal>()
        try {
            if (isRooted()) {
                signals.add(Signal("root_detected", 5, "root_indicators"))
            }
        } catch (_: Throwable) { /* ignore */ }

        try {
            if (isEmulator()) {
                signals.add(Signal("emulator_detected", 2, Build.FINGERPRINT ?: ""))
            }
        } catch (_: Throwable) { /* ignore */ }

        try {
            if (isDebuggable(context)) {
                signals.add(Signal("debug_detected", 4, "application_debuggable"))
            }
        } catch (_: Throwable) { /* ignore */ }

        try {
            if (Debug.isDebuggerConnected()) {
                signals.add(Signal("debugger_attached", 6, "debug_isDebuggerConnected"))
            }
        } catch (_: Throwable) { /* ignore */ }

        try {
            if (isTracerAttached()) {
                signals.add(Signal("debugger_attached", 6, "tracer_pid_nonzero"))
            }
        } catch (_: Throwable) { /* ignore */ }

        try {
            if (isFridaLikely()) {
                signals.add(Signal("frida_detected", 10, "frida_maps_or_port"))
            }
        } catch (_: Throwable) { /* ignore */ }

        try {
            if (isHookFrameworkPresent()) {
                signals.add(Signal("hook_detected", 7, "xposed_or_lsposed"))
            }
        } catch (_: Throwable) { /* ignore */ }

        try {
            if (isCloneEnvironment(context)) {
                signals.add(Signal("clone_detected", 6, "dual_app_path"))
            }
        } catch (_: Throwable) { /* ignore */ }

        val certSha = try {
            getSigningCertSha256(context)
        } catch (_: Throwable) {
            ""
        }

        val expected = expectedCertSha256?.trim()?.lowercase().orEmpty()
        if (expected.isNotEmpty() && certSha.isNotEmpty() && certSha != expected) {
            signals.add(Signal("resigned_apk", 8, "signing_cert_mismatch"))
        }

        val total = signals.sumOf { it.riskScore }
        return AuditPayload(signals, total, certSha)
    }

    data class AuditPayload(
        val signals: List<Signal>,
        val totalScore: Int,
        val signingCertSha256: String,
    )

    fun getSigningCertSha256(context: Context): String {
        val pm = context.packageManager
        val pkg = context.packageName
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }
        @Suppress("DEPRECATION")
        val info = pm.getPackageInfo(pkg, flags)
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = info.signingInfo ?: return ""
            if (signingInfo.hasMultipleSigners()) {
                signingInfo.apkContentsSigners
            } else {
                signingInfo.signingCertificateHistory
            }
        } else {
            info.signatures
        }
        val first = signatures?.firstOrNull() ?: return ""
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = digest.digest(first.toByteArray())
        return bytes.joinToString("") { b -> "%02x".format(b) }
    }

    private fun isRooted(): Boolean {
        val tags = Build.TAGS?.lowercase().orEmpty()
        if (tags.contains("test-keys")) return true

        val suPaths = arrayOf(
            "/system/app/Superuser.apk",
            "/system/xbin/su",
            "/system/bin/su",
            "/sbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/data/local/su",
            "/system/sbin/su",
            "/vendor/bin/su",
        )
        if (suPaths.any { File(it).exists() }) return true

        val rootPackages = arrayOf(
            "com.noshufou.android.su",
            "com.thirdparty.superuser",
            "eu.chainfire.supersu",
            "com.topjohnwu.magisk",
            "com.kingroot.kinguser",
        )
        // Package checks need context; path + tags are enough for score signal.
        return rootPackages.any { pkg -> File("/data/data/$pkg").exists() }
    }

    private fun isEmulator(): Boolean {
        val fingerprint = Build.FINGERPRINT?.lowercase().orEmpty()
        val model = Build.MODEL?.lowercase().orEmpty()
        val manufacturer = Build.MANUFACTURER?.lowercase().orEmpty()
        val hardware = Build.HARDWARE?.lowercase().orEmpty()
        val product = Build.PRODUCT?.lowercase().orEmpty()
        if (fingerprint.contains("generic") || fingerprint.contains("unknown")) return true
        if (model.contains("google_sdk") || model.contains("emulator") || model.contains("android sdk")) return true
        if (manufacturer.contains("genymotion")) return true
        if (hardware.contains("goldfish") || hardware.contains("ranchu")) return true
        if (product.contains("sdk") || product.contains("emulator")) return true
        return false
    }

    private fun isDebuggable(context: Context): Boolean {
        val flags = context.applicationInfo.flags
        return (flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }

    private fun isTracerAttached(): Boolean {
        val status = File("/proc/self/status")
        if (!status.canRead()) return false
        BufferedReader(status.reader()).use { reader ->
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                if (line!!.startsWith("TracerPid:")) {
                    val pid = line!!.substringAfter(":").trim()
                    return pid != "0"
                }
            }
        }
        return false
    }

    private fun isFridaLikely(): Boolean {
        if (mapsContain("frida") || mapsContain("gum-js-loop") || mapsContain("libgadget")) {
            return true
        }
        return isLocalPortOpen(27042) || isLocalPortOpen(27043)
    }

    private fun mapsContain(needle: String): Boolean {
        val maps = File("/proc/self/maps")
        if (!maps.canRead()) return false
        val buf = ByteArray(8192)
        FileInputStream(maps).use { input ->
            var read = input.read(buf)
            while (read > 0) {
                val chunk = String(buf, 0, read).lowercase()
                if (chunk.contains(needle)) return true
                read = input.read(buf)
            }
        }
        return false
    }

    private fun isLocalPortOpen(port: Int): Boolean {
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress("127.0.0.1", port), 80)
                true
            }
        } catch (_: Throwable) {
            false
        }
    }

    private fun isHookFrameworkPresent(): Boolean {
        val xposedPaths = arrayOf(
            "/system/framework/XposedBridge.jar",
            "/system/lib/libxposed_art.so",
            "/data/adb/lspd",
            "/data/adb/modules/riru",
        )
        if (xposedPaths.any { File(it).exists() }) return true
        return try {
            throw Exception("probe")
        } catch (e: Exception) {
            e.stackTrace.any { frame ->
                val cn = frame.className.lowercase()
                cn.contains("xposed") || cn.contains("lsposed") || cn.contains("edxposed")
            }
        }
    }

    private fun isCloneEnvironment(context: Context): Boolean {
        val path = context.filesDir?.path?.lowercase().orEmpty()
        if (path.isEmpty()) return false
        val markers = arrayOf("parallel", "dual", "clone", "multiaccount", "virtual")
        return markers.any { path.contains(it) }
    }
}
