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
 *   GET {apiBase}/api/app-update/check
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
 *     "release_notes": "…"
 *   }
 *
 * Security: only HTTPS responses are honored when the response carries
 * an `apk_url`; an HTTP-only APK URL is forced into [UpdateDecision.NONE].
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
        val url = Uri.parse("$base/api/app-update/check")
            .buildUpon()
            .appendQueryParameter("platform", "android")
            .appendQueryParameter("package", packageName)
            .appendQueryParameter("version_code", currentVersionCode.toString())
            .appendQueryParameter("version_name", currentVersionName)
            .apply { if (!deviceId.isNullOrBlank()) appendQueryParameter("device_id", deviceId) }
            .build()
            .toString()

        val raw = httpGet(url)
        val json = JSONObject(raw)
        return UpdateInfo.fromJson(json)
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
) {
    companion object {
        fun fromJson(j: JSONObject): UpdateInfo {
            val rawDecision = pickString(j, "decision", "update_decision", "updateDecision")
            var decision = UpdateDecision.parse(rawDecision)
            val apkUrl = pickString(j, "apk_url", "apkUrl")
            val apkSha = pickString(j, "apk_sha256", "apkSha256", "sha256")

            // Refuse plain-HTTP APK URLs at the parse layer.
            if (decision == UpdateDecision.SOFT || decision == UpdateDecision.FORCE) {
                if (apkUrl == null || !apkUrl.startsWith("https://", ignoreCase = true)) {
                    decision = if (pickString(j, "play_store_url", "playStoreUrl") != null) {
                        UpdateDecision.PLAY_STORE
                    } else {
                        UpdateDecision.NONE
                    }
                }
            }

            return UpdateInfo(
                decision = decision,
                latestVersionCode = pickInt(j, "latest_version_code", "latestVersionCode") ?: 0,
                latestVersionName = pickString(j, "latest_version_name", "latestVersionName") ?: "",
                minSupportedVersionCode = pickInt(j, "min_supported_version_code", "minSupportedVersionCode") ?: 0,
                autoDownload = pickBool(j, "auto_download", "autoDownload") ?: false,
                apkUrl = apkUrl,
                apkSha256 = apkSha?.lowercase(),
                apkSizeBytes = pickLong(j, "apk_size_bytes", "apkSizeBytes") ?: 0L,
                playStoreUrl = pickString(j, "play_store_url", "playStoreUrl"),
                releaseNotes = pickString(j, "release_notes", "releaseNotes"),
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
