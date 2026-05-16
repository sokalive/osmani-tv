package com.osmantv.update

import android.net.Uri
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * Talks to the admin OTA endpoint. Single responsibility: HTTPS GET
 * with timeouts, parse the response into a strongly-typed [UpdateInfo].
 *
 * The endpoint contract (documented in modules/osmani-update/README.md):
 *
 *   GET {apiBase}/update-check
 *       ?platform=android
 *       &package={pkg}
 *       &version_code={int}
 *       &version_name={x.y.z}
 *       &device_id={uuid}            (optional)
 *
 * Response (JSON, fields in either snake_case or camelCase):
 *   {
 *     "decision": "NONE" | "SOFT" | "FORCE" | "PLAY_STORE",
 *     "latest_version_code": 23,
 *     "latest_version_name": "1.2.3",
 *     "min_supported_version_code": 20,
 *     "auto_download": true,
 *     "apk_url": "https://.../osmanitv-1.2.3.apk",
 *     "apk_sha256": "abcd…64hex…",
 *     "apk_size_bytes": 12345678,
 *     "play_store_url": "https://play.google.com/...",
 *     "playstore_url": "https://play.google.com/...",
 *     "release_notes": "…",
 *     "notice": "…",
 *     "source": "apk" | "play" | "notice"
 *   }
 *
 * The backend decision is authoritative. APK transport validation happens
 * only when a download is actually attempted, in [ApkDownloader].
 */
internal object UpdateApi {

    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 15_000

    fun check(
        apiBase: String,
        packageName: String,
        currentVersionCode: Int,
        currentVersionName: String,
        deviceId: String?,
    ): UpdateInfo {
        val base = apiBase.trim().trimEnd('/')
        val endpoints = endpointCandidates(base)
        var lastError: Throwable? = null
        for (endpoint in endpoints) {
            val url = Uri.parse(endpoint)
                .buildUpon()
                .appendQueryParameter("platform", "android")
                .appendQueryParameter("package", packageName)
                .appendQueryParameter("version_code", currentVersionCode.toString())
                .appendQueryParameter("version_name", currentVersionName)
                .apply { if (!deviceId.isNullOrBlank()) appendQueryParameter("device_id", deviceId) }
                .build()
                .toString()
            try {
                val raw = httpGet(url)
                val json = JSONObject(raw)
                return UpdateInfo.fromJson(json)
            } catch (t: Throwable) {
                lastError = t
            }
        }
        throw lastError ?: RuntimeException("No update endpoint candidates available")
    }

    private fun endpointCandidates(base: String): List<String> {
        val normalized = base.trimEnd('/')
        val apiBase = if (normalized.endsWith("/api", ignoreCase = true)) {
            normalized
        } else {
            "$normalized/api"
        }
        // Production contract is /api/update-check. Keep legacy candidates so
        // already-built apps remain tolerant while backend routes settle.
        return listOf(
            "$apiBase/update-check",
            "$apiBase/app-update/check",
            "$apiBase/app-version/check",
            "$apiBase/update/check",
        ).distinct()
    }

    private fun httpGet(urlStr: String): String {
        val parsed = URL(urlStr)
        require(parsed.protocol.equals("https", ignoreCase = true) ||
                parsed.protocol.equals("http", ignoreCase = true)) {
            "Unsupported protocol: ${parsed.protocol}"
        }
        val conn = parsed.openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.requestMethod = "GET"
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "OsmaniTV-Updater/1.0 (Android)")
            conn.connect()
            val code = conn.responseCode
            if (code !in 200..299) {
                throw RuntimeException("HTTP $code ${conn.responseMessage ?: ""}")
            }
            BufferedReader(InputStreamReader(conn.inputStream, StandardCharsets.UTF_8)).use {
                return it.readText()
            }
        } finally {
            try { conn.disconnect() } catch (_: Throwable) {}
        }
    }
}

/** Decisions returned by the backend. Keep in sync with JS UpdateDecision union. */
internal enum class UpdateDecision {
    NONE,
    SOFT,
    FORCE,
    PLAY_STORE;

    companion object {
        fun parse(raw: String?): UpdateDecision = when (raw?.trim()?.uppercase()) {
            "NONE" -> NONE
            "SOFT" -> SOFT
            "FORCE", "FORCED", "HARD" -> FORCE
            "PLAY_STORE", "PLAYSTORE", "STORE" -> PLAY_STORE
            else -> NONE
        }
    }
}

internal data class UpdateInfo(
    val decision: UpdateDecision,
    val latestVersionCode: Int,
    val latestVersionName: String,
    val minSupportedVersionCode: Int,
    val autoDownload: Boolean,
    val apkUrl: String?,
    val apkSha256: String?,
    val apkSizeBytes: Long,
    val playStoreUrl: String?,
    val releaseNotes: String?,
    val notice: String?,
    val title: String?,
    val source: String?,
) {
    /**
     * Server may broadcast FORCE/SOFT globally; only outdated installs should see update UI.
     * When [installedVersionCode] meets or exceeds the published target, treat as satisfied.
     */
    fun effectiveDecision(installedVersionCode: Int): UpdateDecision {
        if (decision == UpdateDecision.NONE) return UpdateDecision.NONE
        val target = serverVersionCodeTarget()
        if (target <= 0) return decision
        return if (installedVersionCode >= target) UpdateDecision.NONE else decision
    }

    /** Primary: latest_version_code; fallback: min_supported_version_code when latest is unset. */
    fun serverVersionCodeTarget(): Int = when {
        latestVersionCode > 0 -> latestVersionCode
        minSupportedVersionCode > 0 -> minSupportedVersionCode
        else -> 0
    }

    companion object {
        fun fromJson(j: JSONObject): UpdateInfo {
            val rawDecision = pickString(j, "decision", "update_decision", "updateDecision")
            val decision = UpdateDecision.parse(rawDecision)
            val apkUrl = pickString(j, "apk_url", "apkUrl")
            val apkSha = pickString(j, "apk_sha256", "apkSha256", "sha256")

            return UpdateInfo(
                decision = decision,
                latestVersionCode = pickInt(j, "latest_version_code", "latestVersionCode") ?: 0,
                latestVersionName = pickString(j, "latest_version_name", "latestVersionName") ?: "",
                minSupportedVersionCode = pickInt(j, "min_supported_version_code", "minSupportedVersionCode") ?: 0,
                autoDownload = pickBool(j, "auto_download", "autoDownload") ?: false,
                apkUrl = apkUrl,
                apkSha256 = apkSha?.lowercase(),
                apkSizeBytes = pickLong(j, "apk_size_bytes", "apkSizeBytes") ?: 0L,
                playStoreUrl = pickString(j, "play_store_url", "playStoreUrl", "playstore_url", "playstoreUrl"),
                releaseNotes = pickString(j, "release_notes", "releaseNotes"),
                notice = pickString(j, "notice", "message", "update_notice", "updateNotice", "body"),
                title = pickString(j, "title", "update_title", "updateTitle", "heading"),
                source = pickString(j, "source", "update_source", "updateSource"),
            )
        }

        private fun pickString(j: JSONObject, vararg keys: String): String? {
            for (k in keys) {
                if (j.has(k) && !j.isNull(k)) {
                    val v = j.optString(k, "").trim()
                    if (v.isNotEmpty()) return v
                }
            }
            return null
        }

        private fun pickInt(j: JSONObject, vararg keys: String): Int? {
            for (k in keys) {
                if (j.has(k) && !j.isNull(k)) return j.optInt(k)
            }
            return null
        }

        private fun pickLong(j: JSONObject, vararg keys: String): Long? {
            for (k in keys) {
                if (j.has(k) && !j.isNull(k)) return j.optLong(k)
            }
            return null
        }

        private fun pickBool(j: JSONObject, vararg keys: String): Boolean? {
            for (k in keys) {
                if (j.has(k) && !j.isNull(k)) return j.optBoolean(k)
            }
            return null
        }
    }
}
