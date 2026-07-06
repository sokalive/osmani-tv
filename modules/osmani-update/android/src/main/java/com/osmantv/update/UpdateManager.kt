package com.osmantv.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Expo Module entry point + orchestrator for the OTA update lifecycle.
 *
 * Public JS API (called from `lib/updateClient.js`):
 *   - getInstalledVersion()                                  → Bundle  (sync)
 *   - checkForUpdate(apiBase, deviceId?)                     → Promise<Bundle>
 *   - downloadAndInstall(apkUrl, expectedSha256?)            → Promise<Bundle> (download + verify only)
 *   - launchInstaller()                                     → Promise<Bundle>
 *   - cancelDownload()                                       → void
 *   - quitApp()                                              → void   (FORCE cancel)
 *
 * Events emitted (`OsmaniUpdate.state`):
 *   { state: "idle" }
 *   { state: "checking" }
 *   { state: "downloading", downloaded: Long, total: Long, percent: Int }
 *   { state: "verifying" }
 *   { state: "downloaded", filePath: String }
 *   { state: "installing", filePath: String }
 *   { state: "needs_unknown_sources_permission" }
 *   { state: "failed", error: String }
 *
 * Decisions returned to JS in `checkForUpdate`:
 *   "NONE" | "SOFT" | "FORCE" | "PLAY_STORE"
 *
 * Threading: every IO call (HTTP, file write, hashing) runs on
 * Dispatchers.IO. The main thread is never blocked.
 */
class UpdateManager : Module() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val downloading = AtomicBoolean(false)
    private val cancelRequested = AtomicBoolean(false)
    @Volatile
    private var pendingApkFile: File? = null

    override fun definition() = ModuleDefinition {
        Name("OsmaniUpdate")

        Events(EVENT_STATE)

        Constants {
            mapOf(
                "PACKAGE_NAME" to (appContext.reactContext?.packageName ?: ""),
                "STATE_EVENT" to EVENT_STATE,
            )
        }

        Function("getInstalledVersion") {
            val ctx = appContext.reactContext
                ?: return@Function Bundle().apply {
                    putString("versionName", "")
                    putInt("versionCode", 0)
                    putString("packageName", "")
                }
            val info = currentPackageInfo(ctx)
            Bundle().apply {
                putString("versionName", info?.versionName ?: "")
                putInt("versionCode", versionCodeOf(info))
                putString("packageName", ctx.packageName)
            }
        }

        AsyncFunction("checkForUpdate") { apiBase: String, deviceId: String?, promise: Promise ->
            scope.launch {
                emit(stateBundle("checking"))
                try {
                    val ctx = appContext.reactContext
                        ?: throw IllegalStateException("react context unavailable")
                    val pkg = ctx.packageName
                    val info = currentPackageInfo(ctx)
                    val versionCode = versionCodeOf(info)
                    val versionName = info?.versionName ?: "0.0.0"

                    val result = withContext(Dispatchers.IO) {
                        UpdateApi.check(apiBase, pkg, versionCode, versionName, deviceId)
                    }
                    emit(stateBundle("idle"))
                    promise.resolve(result.toBundle(versionCode, versionName))
                } catch (t: Throwable) {
                    emit(stateBundle("failed", error = t.message ?: t.javaClass.simpleName))
                    promise.reject("ERR_UPDATE_CHECK", t.message ?: "check failed", t)
                }
            }
        }

        AsyncFunction("downloadAndInstall") { apkUrl: String, expectedSha256: String?, promise: Promise ->
            if (!downloading.compareAndSet(false, true)) {
                promise.reject("ERR_UPDATE_BUSY", "download already in progress", null)
                return@AsyncFunction
            }
            cancelRequested.set(false)
            scope.launch {
                try {
                    val ctx = appContext.reactContext
                        ?: throw IllegalStateException("react context unavailable")

                    val downloader = ApkDownloader(ctx)

                    val file: File = withContext(Dispatchers.IO) {
                        downloader.download(
                            apkUrl = apkUrl,
                            progress = { downloaded, total ->
                                val percent = if (total > 0L) {
                                    ((downloaded * 100L) / total).toInt().coerceIn(0, 100)
                                } else {
                                    -1
                                }
                                emit(
                                    Bundle().apply {
                                        putString("state", "downloading")
                                        putDouble("downloaded", downloaded.toDouble())
                                        putDouble("total", total.toDouble())
                                        putInt("percent", percent)
                                    }
                                )
                            },
                            cancel = { cancelRequested.get() },
                        )
                    }

                    val verify: HashVerifier.VerifyResult? =
                        if (!expectedSha256.isNullOrBlank()) {
                            emit(stateBundle("verifying"))
                            withContext(Dispatchers.IO) {
                                HashVerifier.verify(file, expectedSha256)
                            }.also {
                                if (!it.ok) {
                                    try { file.delete() } catch (_: Throwable) {}
                                    val err = "hash_verify_failed:${it.reason}"
                                    emit(stateBundle("failed", error = err))
                                    promise.reject("ERR_UPDATE_VERIFY", err, null)
                                    return@launch
                                }
                            }
                        } else {
                            // Backend 71174a6 made SHA optional for permissive
                            // update decisions. Install still requires HTTPS APK
                            // transport, but hash verification is skipped when
                            // no expected hash is provided.
                            null
                        }

                    pendingApkFile = file
                    emit(
                        Bundle().apply {
                            putString("state", "downloaded")
                            putString("filePath", file.absolutePath)
                        }
                    )
                    promise.resolve(
                        Bundle().apply {
                            putString("status", "downloaded")
                            putString("filePath", file.absolutePath)
                            putString("verifiedSha256", verify?.actual ?: "")
                            putBoolean("sha256Verified", verify != null)
                        }
                    )
                } catch (t: Throwable) {
                    val msg = t.message ?: t.javaClass.simpleName
                    emit(stateBundle("failed", error = msg))
                    promise.reject("ERR_UPDATE_DOWNLOAD", msg, t)
                } finally {
                    downloading.set(false)
                    cancelRequested.set(false)
                }
            }
        }

        AsyncFunction("launchInstaller") { promise: Promise ->
            scope.launch {
                try {
                    val ctx = appContext.reactContext
                        ?: throw IllegalStateException("react context unavailable")
                    val file = pendingApkFile
                        ?: throw IllegalStateException("no_downloaded_apk")
                    if (!file.exists() || file.length() <= 0L) {
                        pendingApkFile = null
                        throw IllegalStateException("missing_apk_file")
                    }

                    emit(
                        Bundle().apply {
                            putString("state", "installing")
                            putString("filePath", file.absolutePath)
                        }
                    )

                    val result = ApkInstaller.install(ctx, file)
                    when (result) {
                        is ApkInstaller.LaunchResult.Launched -> {
                            promise.resolve(
                                Bundle().apply {
                                    putString("status", "installer_launched")
                                    putString("filePath", file.absolutePath)
                                }
                            )
                        }
                        is ApkInstaller.LaunchResult.NeedsUnknownSourcesPermission -> {
                            emit(stateBundle("needs_unknown_sources_permission"))
                            promise.resolve(
                                Bundle().apply {
                                    putString("status", "needs_unknown_sources_permission")
                                    putString("filePath", file.absolutePath)
                                }
                            )
                        }
                        is ApkInstaller.LaunchResult.Failed -> {
                            emit(stateBundle("failed", error = result.reason))
                            promise.reject("ERR_UPDATE_INSTALL", result.reason, null)
                        }
                    }
                } catch (t: Throwable) {
                    val msg = t.message ?: t.javaClass.simpleName
                    emit(stateBundle("failed", error = msg))
                    promise.reject("ERR_UPDATE_INSTALL", msg, t)
                }
            }
        }

        Function("cancelDownload") {
            if (downloading.get()) {
                cancelRequested.set(true)
            }
            pendingApkFile?.let {
                try { it.delete() } catch (_: Throwable) {}
            }
            pendingApkFile = null
        }

        Function("quitApp") {
            ApkInstaller.quitApp(appContext.currentActivity)
        }

        AsyncFunction("handleLandingInstallLink") { uriString: String, promise: Promise ->
            scope.launch {
                try {
                    val ctx = appContext.reactContext
                        ?: throw IllegalStateException("react context unavailable")
                    val coordinator = LandingInstallCoordinator(ctx.applicationContext)
                    val params = coordinator.parseUri(Uri.parse(uriString))
                        ?: throw IllegalArgumentException("invalid_landing_install_link")

                    val result = coordinator.run(
                        params,
                        onProgress = { progress ->
                        when (progress) {
                            is LandingInstallCoordinator.Progress.Downloading -> {
                                emit(
                                    Bundle().apply {
                                        putString("state", "downloading")
                                        putDouble("downloaded", progress.downloaded.toDouble())
                                        putDouble("total", progress.total.toDouble())
                                        putInt("percent", progress.percent)
                                    },
                                )
                            }
                            is LandingInstallCoordinator.Progress.Verifying ->
                                emit(stateBundle("verifying"))
                            is LandingInstallCoordinator.Progress.Ready ->
                                emit(stateBundle("downloaded"))
                            is LandingInstallCoordinator.Progress.InstallerLaunched ->
                                emit(stateBundle("installing"))
                            is LandingInstallCoordinator.Progress.NeedsUnknownSources ->
                                emit(stateBundle("needs_unknown_sources_permission"))
                            is LandingInstallCoordinator.Progress.Failed ->
                                emit(stateBundle("failed", error = progress.reason))
                            else -> Unit
                        }
                    },
                    )

                    when (result) {
                        is LandingInstallCoordinator.Progress.InstallerLaunched -> {
                            promise.resolve(
                                Bundle().apply {
                                    putString("status", "installer_launched")
                                },
                            )
                        }
                        is LandingInstallCoordinator.Progress.NeedsUnknownSources -> {
                            promise.resolve(
                                Bundle().apply {
                                    putString("status", "needs_unknown_sources_permission")
                                },
                            )
                        }
                        is LandingInstallCoordinator.Progress.Failed -> {
                            promise.reject("ERR_LANDING_INSTALL", result.reason, null)
                        }
                        else -> {
                            promise.resolve(
                                Bundle().apply {
                                    putString("status", "in_progress")
                                },
                            )
                        }
                    }
                } catch (t: Throwable) {
                    val msg = t.message ?: t.javaClass.simpleName
                    emit(stateBundle("failed", error = msg))
                    promise.reject("ERR_LANDING_INSTALL", msg, t)
                }
            }
        }

        AsyncFunction("openPlayStore") { url: String, promise: Promise ->
            try {
                val ctx = appContext.reactContext
                    ?: throw IllegalStateException("react context unavailable")
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    setPackage("com.android.vending")
                }
                try {
                    ctx.startActivity(intent)
                } catch (_: Throwable) {
                    // Play Store not available — fall back to a generic browser intent.
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                }
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("ERR_OPEN_STORE", t.message ?: "open_failed", t)
            }
        }
    }

    // -- helpers -----------------------------------------------------------

    private fun emit(bundle: Bundle) {
        try {
            sendEvent(EVENT_STATE, bundle)
        } catch (_: Throwable) {
            // event bus may be torn down during reload — never crash on emit.
        }
    }

    private fun stateBundle(state: String, error: String? = null): Bundle = Bundle().apply {
        putString("state", state)
        if (error != null) putString("error", error)
    }

    private fun currentPackageInfo(ctx: Context): PackageInfo? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.PackageInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        }
    } catch (_: Throwable) {
        null
    }

    private fun versionCodeOf(info: PackageInfo?): Int {
        if (info == null) return 0
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode.toInt()
        } else {
            @Suppress("DEPRECATION")
            info.versionCode
        }
    }

    companion object {
        const val EVENT_STATE = "OsmaniUpdate.state"
    }
}

private fun UpdateInfo.toBundle(installedVersionCode: Int, installedVersionName: String): Bundle =
    Bundle().apply {
        val effective = effectiveDecision(installedVersionCode)
        val suppressed = effective != decision
        putString("decision", effective.name)
        putBoolean("updateSuppressed", suppressed)
        if (suppressed) {
            putString("rawDecision", decision.name)
            putInt("serverVersionCodeTarget", serverVersionCodeTarget())
        }
        putInt("latestVersionCode", latestVersionCode)
        putString("latestVersionName", latestVersionName)
        putInt("minSupportedVersionCode", minSupportedVersionCode)
        putBoolean("autoDownload", autoDownload)
        putString("apkUrl", apkUrl ?: "")
        putString("apkSha256", apkSha256 ?: "")
        putDouble("apkSizeBytes", apkSizeBytes.toDouble())
        putString("playStoreUrl", playStoreUrl ?: "")
        putString("releaseNotes", releaseNotes ?: "")
        putString("notice", notice ?: "")
        putString("title", title ?: "")
        putString("source", source ?: "")
        putInt("installedVersionCode", installedVersionCode)
        putString("installedVersionName", installedVersionName)
    }
