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
                return UpdateInfo.fromJson(
                    json,
                    installedVersionCode = currentVersionCode,
                    requestVersionCode = currentVersionCode,
                )
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
     * Popup / force lock ONLY when installed_version_code < latest_version_code.
     * Admin SOFT/FORCE toggles never affect installs already on latest.
     */
    fun effectiveDecision(installedVersionCode: Int): UpdateDecision {
        if (latestVersionCode > 0 && installedVersionCode >= latestVersionCode) {
            return UpdateDecision.NONE
        }
        if (decision == UpdateDecision.NONE) return UpdateDecision.NONE
        return decision
    }

    /** Published APK target (latest_version_code only). */
    fun serverVersionCodeTarget(): Int = if (latestVersionCode > 0) latestVersionCode else 0

    companion object {
        fun fromJson(
            j: JSONObject,
            installedVersionCode: Int = 0,
            requestVersionCode: Int = installedVersionCode,
        ): UpdateInfo {
            var latestVersionCode = pickInt(j, "latest_version_code", "latestVersionCode") ?: 0
            val responseVersionCode = pickInt(j, "version_code", "versionCode") ?: 0
            if (latestVersionCode <= 0 && responseVersionCode > 0) {
                latestVersionCode = responseVersionCode
            }

            val minSupportedVersionCode =
                pickInt(j, "min_supported_version_code", "minSupportedVersionCode") ?: 0

            val apkUrl = pickString(j, "apk_url", "apkUrl", "download_url", "downloadUrl")
            val apkSha = pickString(j, "apk_sha256", "apkSha256", "sha256")
            val playStoreUrl = pickString(
                j,
                "play_store_url",
                "playStoreUrl",
                "playstore_url",
                "playstoreUrl",
            )
            val apkUrlIsStore = isPlayStoreUrl(apkUrl)
            val effectiveApkUrl = if (apkUrlIsStore) null else apkUrl
            val effectivePlayStoreUrl = when {
                !playStoreUrl.isNullOrBlank() -> playStoreUrl
                apkUrlIsStore -> apkUrl
                else -> null
            }

            val notice = pickString(
                j,
                "notice",
                "message",
                "update_notice",
                "updateNotice",
                "update_message",
                "updateMessage",
                "body",
            )
            val title = pickString(j, "title", "update_title", "updateTitle", "heading")
            val source = pickString(j, "source", "update_source", "updateSource")

            val rawDecision = pickString(j, "decision", "update_decision", "updateDecision")
            var decision = UpdateDecision.parse(rawDecision)

            val installed = when {
                installedVersionCode > 0 -> installedVersionCode
                requestVersionCode > 0 -> requestVersionCode
                else -> 0
            }
            val outdated = latestVersionCode > 0 && installed > 0 && installed < latestVersionCode

            if (!outdated) {
                decision = UpdateDecision.NONE
            } else if (decision == UpdateDecision.NONE) {
                decision = deriveDecision(
                    j = j,
                    hasApkDelivery = !effectiveApkUrl.isNullOrBlank(),
                    hasStoreDelivery = !effectivePlayStoreUrl.isNullOrBlank(),
                    source = source,
                )
            }

            return UpdateInfo(
                decision = decision,
                latestVersionCode = latestVersionCode,
                latestVersionName = pickString(
                    j,
                    "latest_version_name",
                    "latestVersionName",
                    "version_name",
                    "versionName",
                ) ?: "",
                minSupportedVersionCode = minSupportedVersionCode,
                autoDownload = pickBool(j, "auto_download", "autoDownload") ?: false,
                apkUrl = effectiveApkUrl,
                apkSha256 = apkSha?.lowercase(),
                apkSizeBytes = pickLong(j, "apk_size_bytes", "apkSizeBytes") ?: 0L,
                playStoreUrl = effectivePlayStoreUrl,
                releaseNotes = pickString(j, "release_notes", "releaseNotes"),
                notice = notice,
                title = title,
                source = source,
            )
        }

        private fun isPlayStoreUrl(url: String?): Boolean {
            val s = url?.trim()?.lowercase() ?: return false
            return s.contains("play.google.com/") || s.startsWith("market://")
        }

        private fun deriveDecision(
            j: JSONObject,
            hasApkDelivery: Boolean,
            hasStoreDelivery: Boolean,
            source: String?,
        ): UpdateDecision {
            val forceFlag = pickBool(
                j,
                "force_update",
                "forceUpdate",
                "force_update_enabled",
                "forceUpdateEnabled",
            )
            val softFlag = pickBool(
                j,
                "soft_update",
                "softUpdate",
                "soft_update_enabled",
                "softUpdateEnabled",
            )
            val mode = pickString(j, "update_mode", "updateMode", "mode")?.lowercase()

            if (forceFlag == true || mode == "force") return UpdateDecision.FORCE
            if (softFlag == true || mode == "soft") return UpdateDecision.SOFT
            if (source.equals("play", ignoreCase = true) && hasStoreDelivery) {
                return UpdateDecision.PLAY_STORE
            }
            if (hasApkDelivery) return UpdateDecision.SOFT
            if (hasStoreDelivery) return UpdateDecision.PLAY_STORE
            if (source.equals("apk", ignoreCase = true)) return UpdateDecision.SOFT
            return UpdateDecision.NONE
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
