package com.osmantv.update

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Streams the APK from an HTTPS URL into the app's private cache.
 *
 * Hard requirements:
 *   - Plain HTTP is rejected outright (no MITM-installable APKs).
 *   - The download is staged into `cacheDir/osmani_update/<file>.apk`.
 *     `cacheDir` is exposed via the FileProvider (`osmani_update_paths.xml`).
 *   - Progress is reported through [ProgressCallback] so the JS layer
 *     can surface it in the UpdateOverlay.
 *   - The stale APK from any previous run is wiped before writing, so
 *     the cache never grows past one APK.
 *   - Cancellation is cooperative via [shouldCancel].
 */
internal class ApkDownloader(
    private val context: Context,
) {

    fun interface ProgressCallback {
        fun onProgress(downloadedBytes: Long, totalBytes: Long)
    }

    fun interface CancelCheck {
        fun shouldCancel(): Boolean
    }

    @Throws(Exception::class)
    fun download(
        apkUrl: String,
        progress: ProgressCallback,
        cancel: CancelCheck = CancelCheck { false },
    ): File {
        require(apkUrl.startsWith("https://", ignoreCase = true)) {
            "Refusing to download APK over insecure transport: $apkUrl"
        }

        val cacheRoot = File(context.cacheDir, CACHE_SUBDIR).apply {
            if (!exists()) mkdirs()
        }
        wipeCache(cacheRoot)

        val outFile = File(cacheRoot, OUTPUT_FILE_NAME)

        val parsed = URL(apkUrl)
        val conn = parsed.openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", "OsmaniTV-Updater/1.0 (Android)")
            conn.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*")
            conn.connect()

            val code = conn.responseCode
            if (code !in 200..299) {
                throw RuntimeException("APK download HTTP $code ${conn.responseMessage ?: ""}")
            }

            val total = conn.contentLengthLong.takeIf { it > 0L } ?: -1L
            var downloaded = 0L
            val buf = ByteArray(BUFFER_SIZE)

            conn.inputStream.use { input ->
                FileOutputStream(outFile).use { output ->
                    while (true) {
                        if (cancel.shouldCancel()) {
                            output.flush()
                            throw InterruptedException("download_cancelled")
                        }
                        val read = input.read(buf)
                        if (read < 0) break
                        output.write(buf, 0, read)
                        downloaded += read.toLong()
                        progress.onProgress(downloaded, total)
                    }
                    output.flush()
                }
            }

            if (outFile.length() == 0L) {
                throw RuntimeException("APK download produced an empty file")
            }
            return outFile
        } catch (t: Throwable) {
            try { outFile.delete() } catch (_: Throwable) {}
            throw t
        } finally {
            try { conn.disconnect() } catch (_: Throwable) {}
        }
    }

    private fun wipeCache(dir: File) {
        try {
            dir.listFiles()?.forEach { f ->
                try { f.delete() } catch (_: Throwable) {}
            }
        } catch (_: Throwable) {}
    }

    companion object {
        const val CACHE_SUBDIR = "osmani_update"
        const val OUTPUT_FILE_NAME = "osmanitv-update.apk"
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 30_000
        private const val BUFFER_SIZE = 64 * 1024
    }
}
