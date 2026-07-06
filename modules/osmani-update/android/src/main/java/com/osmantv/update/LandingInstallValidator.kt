package com.osmantv.update

import android.net.Uri

/**
 * Validates landing-page install handoff URIs before any APK download.
 *
 * Security:
 *   - HTTPS only for APK URLs
 *   - Host allowlist (Bunny CDN pull zone)
 *   - Pinned SHA-256 (64 hex) and positive byte size
 *   - Install page host allowlist for the deep link itself
 */
internal object LandingInstallValidator {

    private val APK_HOST_ALLOWLIST = setOf(
        "osmani-tv-apk-download.b-cdn.net",
    )

    private val INSTALL_PAGE_HOSTS = setOf(
        "osmani-tv-landing.vercel.app",
    )

    data class Params(
        val apkUrl: String,
        val expectedSha256: String,
        val expectedSizeBytes: Long,
    )

    fun parse(uri: Uri?): Params? {
        if (uri == null) return null

        val host = uri.host?.lowercase() ?: return null
        val isInstallPage = INSTALL_PAGE_HOSTS.contains(host) &&
            (uri.path?.startsWith("/install") == true)
        val isCustomScheme = uri.scheme.equals("osmani", ignoreCase = true) &&
            (uri.host.equals("install", ignoreCase = true) ||
                uri.path?.contains("install") == true)

        if (!isInstallPage && !isCustomScheme) return null

        val apkUrl = uri.getQueryParameter("apk")?.trim().orEmpty()
        val sha256 = uri.getQueryParameter("sha256")?.trim()?.lowercase().orEmpty()
        val sizeRaw = uri.getQueryParameter("size")?.trim().orEmpty()

        if (apkUrl.isEmpty() || sha256.isEmpty() || sizeRaw.isEmpty()) return null

        val apkUri = try {
            Uri.parse(apkUrl)
        } catch (_: Throwable) {
            return null
        }

        if (!apkUri.scheme.equals("https", ignoreCase = true)) return null
        val apkHost = apkUri.host?.lowercase() ?: return null
        if (!APK_HOST_ALLOWLIST.contains(apkHost)) return null
        if (!apkUri.path.orEmpty().endsWith(".apk", ignoreCase = true)) return null

        if (sha256.length != 64 || !sha256.matches(Regex("^[a-f0-9]+$"))) return null

        val size = sizeRaw.toLongOrNull() ?: return null
        if (size <= 0L) return null

        return Params(
            apkUrl = apkUrl,
            expectedSha256 = sha256,
            expectedSizeBytes = size,
        )
    }

    fun validateDownloadedFile(file: java.io.File, params: Params): String? {
        if (!file.exists() || file.length() <= 0L) {
            return "missing_or_empty_file"
        }
        if (file.length() != params.expectedSizeBytes) {
            return "size_mismatch:expected=${params.expectedSizeBytes},actual=${file.length()}"
        }
        val hash = HashVerifier.verify(file, params.expectedSha256)
        return if (hash.ok) null else hash.reason
    }
}
