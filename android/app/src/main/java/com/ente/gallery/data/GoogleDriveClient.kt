package com.ente.gallery.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class GoogleDriveClient(
    private val clientId: String,
    private val clientSecret: String,
    private val refreshToken: String
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    @Volatile private var cachedToken: String? = null
    @Volatile private var expiresAt: Long = 0

    suspend fun accessToken(): String = withContext(Dispatchers.IO) {
        if (cachedToken != null && System.currentTimeMillis() + 60_000 < expiresAt) return@withContext cachedToken!!
        val body = FormBody.Builder()
            .add("client_id", clientId)
            .add("client_secret", clientSecret)
            .add("refresh_token", refreshToken)
            .add("grant_type", "refresh_token")
            .build()
        val req = Request.Builder().url("https://oauth2.googleapis.com/token").post(body).build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("token refresh ${r.code} ${r.body?.string()?.take(500)}")
            val j = JSONObject(r.body!!.string())
            cachedToken = j.getString("access_token")
            expiresAt = System.currentTimeMillis() + j.getLong("expires_in") * 1000
            cachedToken!!
        }
    }

    suspend fun fetchBytes(fileId: String): ByteArray = withContext(Dispatchers.IO) {
        // Try lh3 CDN first (fast, no auth)
        try {
            val lh3 = Request.Builder().url("https://lh3.googleusercontent.com/d/$fileId=w1600").build()
            http.newCall(lh3).execute().use { r ->
                if (r.isSuccessful) {
                    val ct = r.header("content-type") ?: ""
                    val b = r.body?.bytes()
                    if (b != null && b.size > 10_000 && (ct.startsWith("image/") || b.size > 50000)) return@withContext b
                }
            }
        } catch (_: Exception) {}

        val token = accessToken()
        val req = Request.Builder()
            .url("https://www.googleapis.com/drive/v3/files/$fileId?alt=media&supportsAllDrives=true")
            .header("Authorization", "Bearer $token")
            .build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("Drive media ${r.code} for $fileId")
            r.body!!.bytes()
        }
    }
}
