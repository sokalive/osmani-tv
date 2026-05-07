package com.osmantv.update

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * Hands the verified APK off to the system installer.
 *
 * Flow:
 *   1. Caller supplies the APK [File] that has already passed
 *      [HashVerifier.verify]. Installer makes no security decisions
 *      itself — it only refuses to launch on missing/empty files.
 *   2. The cache file is exposed via this module's FileProvider
 *      (authority = "${applicationId}.osmaniupdate.fileprovider").
 *   3. We launch ACTION_VIEW with the package-archive MIME type plus
 *      `FLAG_GRANT_READ_URI_PERMISSION` and `FLAG_ACTIVITY_NEW_TASK`.
 *   4. On API 26+ we additionally check
 *      `packageManager.canRequestPackageInstalls()`. If the user has
 *      not granted "Install from unknown sources" yet, we route them
 *      to `ACTION_MANAGE_UNKNOWN_APP_SOURCES` so they can flip the
 *      switch — then the next launch of the installer will succeed.
 *
 * The system installer takes over the UI from this point and asks the
 * user to confirm the install. When the user accepts, the new APK is
 * installed and the app is replaced.
 */
internal object ApkInstaller {

    /** Result of a launch attempt — drives JS-side state machine. */
    sealed interface LaunchResult {
        object Launched : LaunchResult
        object NeedsUnknownSourcesPermission : LaunchResult
        data class Failed(val reason: String) : LaunchResult
    }

    fun install(context: Context, apkFile: File): LaunchResult {
        if (!apkFile.exists() || apkFile.length() <= 0L) {
            return LaunchResult.Failed("missing_apk_file")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canInstall = try {
                context.packageManager.canRequestPackageInstalls()
            } catch (_: Throwable) {
                false
            }
            if (!canInstall) {
                openUnknownSourcesSettings(context)
                return LaunchResult.NeedsUnknownSourcesPermission
            }
        }

        val authority = "${context.packageName}.osmaniupdate.fileprovider"
        val uri: Uri = try {
            FileProvider.getUriForFile(context, authority, apkFile)
        } catch (e: IllegalArgumentException) {
            return LaunchResult.Failed("file_provider_misconfigured: ${e.message}")
        }

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    or Intent.FLAG_ACTIVITY_NEW_TASK
                    or Intent.FLAG_ACTIVITY_CLEAR_TOP
            )
        }

        return try {
            context.startActivity(intent)
            LaunchResult.Launched
        } catch (e: ActivityNotFoundException) {
            LaunchResult.Failed("no_installer_activity: ${e.message ?: ""}")
        } catch (e: SecurityException) {
            LaunchResult.Failed("security_exception: ${e.message ?: ""}")
        }
    }

    /** Force-quit the app — used for FORCE update cancel. */
    fun quitApp(activity: Activity?) {
        try {
            activity?.finishAffinity()
        } catch (_: Throwable) {}
        try {
            android.os.Process.killProcess(android.os.Process.myPid())
        } catch (_: Throwable) {}
    }

    private fun openUnknownSourcesSettings(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (_: Throwable) {
            // Best-effort; if the device has no such settings screen
            // (rare/custom ROMs) the JS layer surfaces a SOFT failure.
        }
    }
}
