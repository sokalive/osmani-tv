package com.osmantv.update

import android.os.Bundle
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * Entry point for landing-page install App Links / custom scheme.
 *
 * https://osmani-tv-landing.vercel.app/install?apk=…&amp;sha256=…&amp;size=…
 * osmani://install?apk=…&amp;sha256=…&amp;size=…
 *
 * Downloads once, verifies, then launches the real Android Package Installer.
 */
class LandingInstallActivity : AppCompatActivity() {

    private val coordinator by lazy { LandingInstallCoordinator(this) }
    private var messageView: TextView? = null
    private var progressBar: ProgressBar? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_landing_install)
        messageView = findViewById(R.id.landing_install_message)
        progressBar = findViewById(R.id.landing_install_progress)

        val params = coordinator.parseUri(intent?.data)
        if (params == null) {
            showMessage("Invalid install link.")
            finish()
            return
        }

        lifecycleScope.launch {
            val result = coordinator.run(params, ::renderProgress)
            when (result) {
                is LandingInstallCoordinator.Progress.InstallerLaunched -> {
                    showMessage("Confirm install in the Android installer.")
                    // Leave activity so user sees system UI; finish after short delay.
                    finish()
                }
                is LandingInstallCoordinator.Progress.NeedsUnknownSources -> {
                    showMessage("Allow installs from Osmani TV, then return here.")
                }
                is LandingInstallCoordinator.Progress.Failed -> {
                    showMessage("Install failed: ${result.reason}")
                }
                else -> Unit
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (coordinator.hasPendingApk()) {
            lifecycleScope.launch {
                coordinator.launchInstaller(onProgress = ::renderProgress)
            }
        }
    }

    private fun renderProgress(progress: LandingInstallCoordinator.Progress) {
        when (progress) {
            is LandingInstallCoordinator.Progress.Preparing ->
                showMessage("Preparing download…", indeterminate = true)
            is LandingInstallCoordinator.Progress.Downloading -> {
                if (progress.percent >= 0) {
                    progressBar?.isIndeterminate = false
                    progressBar?.progress = progress.percent
                    val mb = progress.downloaded / (1024.0 * 1024.0)
                    val totalMb = if (progress.total > 0L) {
                        progress.total / (1024.0 * 1024.0)
                    } else {
                        0.0
                    }
                    showMessage(
                        "Downloading… ${progress.percent}% (${"%.2f".format(mb)} / ${"%.2f".format(totalMb)} MB)",
                        indeterminate = false,
                        percent = progress.percent,
                    )
                } else {
                    showMessage("Downloading…", indeterminate = true)
                }
            }
            is LandingInstallCoordinator.Progress.Verifying ->
                showMessage("Verifying APK…", indeterminate = true)
            is LandingInstallCoordinator.Progress.Ready ->
                showMessage("Opening Android installer…", indeterminate = true)
            is LandingInstallCoordinator.Progress.InstallerLaunched ->
                showMessage("Confirm install in the Android installer.", indeterminate = false)
            is LandingInstallCoordinator.Progress.NeedsUnknownSources ->
                showMessage("Allow installs from Osmani TV in Settings.", indeterminate = true)
            is LandingInstallCoordinator.Progress.Failed ->
                showMessage("Install failed: ${progress.reason}", indeterminate = false)
        }
    }

    private fun showMessage(
        text: String,
        indeterminate: Boolean = false,
        percent: Int = 0,
    ) {
        messageView?.text = text
        progressBar?.isIndeterminate = indeterminate
        if (!indeterminate && percent > 0) {
            progressBar?.progress = percent
        }
    }
}
