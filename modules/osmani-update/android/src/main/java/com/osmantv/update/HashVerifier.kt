package com.osmantv.update

import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/**
 * SHA-256 verifier used to gate APK installs.
 *
 * Security model:
 *   - The expected hash MUST come from the trusted backend response
 *     (`apk_sha256`), served over HTTPS.
 *   - The downloaded APK file is hashed locally with the platform
 *     `MessageDigest("SHA-256")` and compared in constant time.
 *   - Any mismatch (or empty/short expected hash) rejects the install.
 *   - Hex comparison is case-insensitive but length-strict.
 */
internal object HashVerifier {

    private const val BUFFER_SIZE = 64 * 1024

    /** Returns the lower-case hex SHA-256 of [file]. */
    fun sha256Hex(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buf = ByteArray(BUFFER_SIZE)
            while (true) {
                val read = input.read(buf)
                if (read <= 0) break
                md.update(buf, 0, read)
            }
        }
        return md.digest().toHex()
    }

    /**
     * Verifies that [file] matches [expectedHex] (SHA-256, hex).
     * Returns true only on a strict, length-matched, case-insensitive
     * equality. An empty/blank/short [expectedHex] is treated as a
     * verification failure — never a pass-through.
     */
    fun verify(file: File, expectedHex: String?): VerifyResult {
        if (expectedHex.isNullOrBlank()) {
            return VerifyResult(
                ok = false,
                reason = "missing_expected_hash",
                actual = null,
            )
        }
        val expected = expectedHex.trim().lowercase()
        if (expected.length != 64 || !expected.matches(HEX_REGEX)) {
            return VerifyResult(
                ok = false,
                reason = "invalid_expected_hash_format",
                actual = null,
            )
        }
        if (!file.exists() || file.length() == 0L) {
            return VerifyResult(
                ok = false,
                reason = "missing_or_empty_file",
                actual = null,
            )
        }
        val actual = sha256Hex(file)
        val ok = constantTimeEquals(actual, expected)
        return VerifyResult(
            ok = ok,
            reason = if (ok) "ok" else "hash_mismatch",
            actual = actual,
        )
    }

    private val HEX_REGEX = Regex("^[a-f0-9]+$")

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) {
            diff = diff or (a[i].code xor b[i].code)
        }
        return diff == 0
    }

    private fun ByteArray.toHex(): String {
        val sb = StringBuilder(size * 2)
        for (byte in this) {
            sb.append(HEX_CHARS[(byte.toInt() ushr 4) and 0x0F])
            sb.append(HEX_CHARS[byte.toInt() and 0x0F])
        }
        return sb.toString()
    }

    private val HEX_CHARS = "0123456789abcdef".toCharArray()

    data class VerifyResult(
        val ok: Boolean,
        val reason: String,
        val actual: String?,
    )
}
