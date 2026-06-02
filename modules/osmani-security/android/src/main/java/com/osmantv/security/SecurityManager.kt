package com.osmantv.security

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SecurityManager : Module() {

    override fun definition() = ModuleDefinition {
        Name("OsmaniSecurity")

        Function("setSecureWindow") { enabled: Boolean ->
            val activity = appContext.currentActivity ?: return@Function
            activity.runOnUiThread {
                if (enabled) {
                    activity.window.setFlags(
                        WindowManager.LayoutParams.FLAG_SECURE,
                        WindowManager.LayoutParams.FLAG_SECURE,
                    )
                } else {
                    activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                }
            }
        }

        Function("getSigningCertSha256") {
            val ctx = appContext.reactContext ?: return@Function ""
            try {
                SecurityAuditor.getSigningCertSha256(ctx)
            } catch (_: Throwable) {
                ""
            }
        }

        AsyncFunction("runSecurityAudit") { expectedCertSha256: String?, expectedPackageName: String? ->
            val ctx = appContext.reactContext
                ?: return@AsyncFunction Bundle().apply {
                    putInt("total_score", 0)
                    putString("signing_cert_sha256", "")
                    putString("package_name", "")
                    putInt("version_code", 0)
                    putString("version_name", "")
                    putParcelableArrayList("signals", arrayListOf())
                }

            val payload = SecurityAuditor.audit(ctx, expectedCertSha256, expectedPackageName)
            val info = try {
                val flags = 0
                ctx.packageManager.getPackageInfo(ctx.packageName, flags)
            } catch (_: Throwable) {
                null
            }

            val signals = ArrayList<Bundle>()
            for (signal in payload.signals) {
                signals.add(
                    Bundle().apply {
                        putString("risk_type", signal.riskType)
                        putInt("risk_score", signal.riskScore)
                        putString("detail", signal.detail)
                    },
                )
            }

            Bundle().apply {
                putParcelableArrayList("signals", signals)
                putInt("total_score", payload.totalScore)
                putString("signing_cert_sha256", payload.signingCertSha256)
                putString("package_name", ctx.packageName)
                putInt("version_code", versionCodeOf(info))
                putString("version_name", info?.versionName ?: "")
            }
        }
    }

    private fun versionCodeOf(info: android.content.pm.PackageInfo?): Int {
        if (info == null) return 0
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode.toInt()
        } else {
            @Suppress("DEPRECATION")
            info.versionCode
        }
    }
}
