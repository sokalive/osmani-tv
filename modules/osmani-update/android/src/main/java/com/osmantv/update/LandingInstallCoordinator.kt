package com.osmantv.update

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Shared landing-install pipeline for [LandingInstallActivity] and
 * [UpdateManager.handleLandingInstallLink].
 *
 * Exactly one CDN download per coordinator instance; verifies size + SHA-256
 * before [ApkInstaller] launches the real system Package Installer UI.
 */
internal class LandingInstallCoordinator(
    private val context: Context,
) {
    sealed interface Progress {
        data object Preparing : Progress
        data class Downloading(val downloaded: Long, val total: Long, val percent: Int) : Progress
        data object Verifying : Progress
        data class Ready(val file: File) : Progress
        data class InstallerLaunched(val file: File) : Progress
        data class NeedsUnknownSources(val file: File) : Progress
        data class Failed(val reason: String) : Progress
    }

    private val busy = AtomicBoolean(false)
    private var pendingFile: File? = null
    private var lastParams: LandingInstallValidator.Params? = null

    fun parseUri(uri: Uri?): LandingInstallValidator.Params? =
        LandingInstallValidator.parse(uri)

    suspend fun run(
        params: LandingInstallValidator.Params,
        onProgress: (Progress) -> Unit,
        shouldCancel: () -> Boolean = { false },
    ): Progress {
        if (!busy.compareAndSet(false, true)) {
            return Progress.Failed("install_already_in_progress")
        }

        return try {
            onProgress(Progress.Preparing)
            pendingFile?.let {
                try { it.delete() } catch (_: Throwable) {}
            }
            pendingFile = null
            lastParams = params

            val downloader = ApkDownloader(context.applicationContext)
            val file = withContext(Dispatchers.IO) {
                downloader.download(
                    apkUrl = params.apkUrl,
                    progress = { downloaded, total ->
                        val percent = if (total > 0L) {
                            ((downloaded * 100L) / total).toInt().coerceIn(0, 100)
                        } else {
                            -1
                        }
                        onProgress(Progress.Downloading(downloaded, total, percent))
                    },
                    cancel = { shouldCancel() },
                )
            }

            onProgress(Progress.Verifying)
            val validationError = withContext(Dispatchers.IO) {
                LandingInstallValidator.validateDownloadedFile(file, params)
            }
            if (validationError != null) {
                try { file.delete() } catch (_: Throwable) {}
                return Progress.Failed(validationError)
            }

            pendingFile = file
            onProgress(Progress.Ready(file))
            launchInstaller(file, onProgress)
        } catch (t: Throwable) {
            Progress.Failed(t.message ?: t.javaClass.simpleName)
        } finally {
            busy.set(false)
        }
    }

    fun launchInstaller(
        file: File = pendingFile ?: return Progress.Failed("no_downloaded_apk"),
        onProgress: (Progress) -> Unit = {},
    ): Progress {
        if (!file.exists() || file.length() <= 0L) {
            pendingFile = null
            return Progress.Failed("missing_apk_file")
        }

        return when (val result = ApkInstaller.install(context.applicationContext, file)) {
            is ApkInstaller.LaunchResult.Launched -> {
                onProgress(Progress.InstallerLaunched(file))
                Progress.InstallerLaunched(file)
            }
            is ApkInstaller.LaunchResult.NeedsUnknownSourcesPermission -> {
                onProgress(Progress.NeedsUnknownSources(file))
                Progress.NeedsUnknownSources(file)
            }
            is ApkInstaller.LaunchResult.Failed -> {
                onProgress(Progress.Failed(result.reason))
                Progress.Failed(result.reason)
            }
        }
    }

    fun hasPendingApk(): Boolean {
        val f = pendingFile ?: return false
        return f.exists() && f.length() > 0L
    }

    fun cancel() {
        pendingFile?.let {
            try { it.delete() } catch (_: Throwable) {}
        }
        pendingFile = null
        lastParams = null
        busy.set(false)
    }
}
