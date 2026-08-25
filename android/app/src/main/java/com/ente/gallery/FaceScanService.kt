package com.ente.gallery

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.ente.gallery.data.GoogleDriveClient
import com.ente.gallery.data.SupabaseRepo
import com.ente.gallery.face.FaceEngine
import kotlinx.coroutines.*
import org.opencv.android.OpenCVLoaderCallback
import org.opencv.core.Mat
import org.opencv.imgcodecs.Imgcodecs
import java.io.File
import kotlin.math.max

class FaceScanService : Service() {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val all = intent?.getBooleanExtra("all", false) ?: false
        startForeground(1, notif("Ente re-embed", "Starting..."))
        job = scope.launch { runLoop(all) }
        return START_NOT_STICKY
    }

    private suspend fun runLoop(all: Boolean) {
        val threshold = BuildConfig.FACE_THRESHOLD.toDoubleOrNull() ?: 0.28
        val margin = BuildConfig.FACE_MARGIN.toDoubleOrNull() ?: 0.06
        val floor = BuildConfig.FACE_FLOOR.toDoubleOrNull() ?: 0.20

        // OpenCV init
        try { System.loadLibrary("opencv_java4") } catch (_: Exception) {}

        val modelsDir = File(filesDir, "models")
        val engine = FaceEngine(this)
        try { engine.load(modelsDir) } catch (e: Exception) {
            notify("Models missing", e.message ?: "push .onnx to ${modelsDir.absolutePath}")
            stopSelf(); return
        }

        val supa = SupabaseRepo(this)
        // Drive client would need secrets from EncryptedSharedPreferences — for now use Next.js proxy /api/image
        // If you set google creds in local.properties, wire GoogleDriveClient here instead.
        val drive = try {
            // fallback to Next.js proxy if no google creds — fetch via supa thumbnail URL?
            null
        } catch (_: Exception) { null }

        var cursor: String? = null
        var total = 0
        val limit = 25
        while (isActive) {
            val batch = try {
                if (all) supa.fetchAll(cursor, limit) else supa.fetchPending(limit)
            } catch (e: Exception) {
                notify("Supabase error", e.message ?: "check SECURITY.md RLS/anon")
                break
            }
            if (batch.isEmpty()) { notify("Done", "Processed $total photos"); break }
            if (all) cursor = batch.last().created_at
            for (photo in batch) {
                if (!isActive) break
                updateNotif("Processing ${photo.file_name ?: photo.id}", "$total scanned")
                try {
                    // isHeic guard
                    if ((photo.mime_type ?: "").lowercase().contains("heic") || (photo.file_name ?: "").lowercase().endsWith(".heic")) {
                        supa.markUnsupported(photo.id)
                        continue
                    }
                    val bytes = fetchBytesFor(photo.google_drive_file_id)
                    if (bytes == null) { notify("Fetch failed", photo.file_name ?: photo.id); continue }
                    val mat = bytesToMat(bytes) ?: continue
                    val faces = withContext(Dispatchers.Default) { engine.detectAndEmbed(mat) }
                    mat.release()
                    if (faces.isEmpty()) {
                        supa.markDone(photo.id, null, null)
                    } else {
                        // batch rpc per face (like local-runner-py)
                        val candidatesList = faces.map { f -> supa.rpcMatchTop2(f.embedding, threshold) }
                        for ((idx, f) in faces.withIndex()) {
                            val cands = candidatesList[idx]
                            val best = decide(cands, threshold, margin, floor)
                            val personId = if (best != null) best.person_id else supa.insertPerson("Unknown", f.embedding)
                            supa.insertFace(photo.id, personId, f.boxNorm, f.embedding)
                        }
                        supa.markDone(photo.id, null, null)
                    }
                    total++
                } catch (e: Exception) {
                    android.util.Log.e("FaceScanService", "photo ${photo.id} failed", e)
                }
            }
            delay(200)
        }
        engine.close()
        stopSelf()
    }

    private fun decide(cands: List<com.ente.gallery.data.MatchCandidate>, thr: Double, margin: Double, floor: Double): com.ente.gallery.data.MatchCandidate? {
        if (cands.isEmpty()) return null
        val best = cands[0]
        val second = cands.getOrNull(1)
        if (best.distance < floor) return best
        if (second == null) return if (best.distance < thr) best else null
        return if (best.distance < thr && second.distance - best.distance >= margin) best else null
    }

    private suspend fun fetchBytesFor(fileId: String): ByteArray? = withContext(Dispatchers.IO) {
        // Prefer Next.js proxy if configured (no google creds on device)
        val base = BuildConfig.SUPABASE_URL // reuse to derive Vercel host? Better set PROXY_URL in BuildConfig
        // Try Supabase thumbnail proxy? For now try lh3 directly
        try {
            val url = "https://lh3.googleusercontent.com/d/$fileId=w1600"
            val req = okhttp3.Request.Builder().url(url).build()
            val resp = okhttp3.OkHttpClient().newCall(req).execute()
            if (resp.isSuccessful) { val b = resp.body?.bytes(); if (b != null && b.size > 10000) return@withContext b }
        } catch (_: Exception) {}
        // Fallback to Drive API if creds available — wire GoogleDriveClient here
        null
    }

    private fun bytesToMat(bytes: ByteArray): Mat? {
        val matOfByte = org.opencv.core.MatOfByte(*bytes)
        return Imgcodecs.imdecode(matOfByte, Imgcodecs.IMREAD_COLOR)
    }

    private fun notif(title: String, text: String): Notification {
        return NotificationCompat.Builder(this, "face_scan")
            .setContentTitle(title).setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true).build()
    }
    private fun notify(title: String, text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(1, notif(title, text))
    }
    private fun updateNotif(title: String, text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(1, notif(title, text))
    }

    override fun onDestroy() { job?.cancel(); scope.cancel(); super.onDestroy() }
}
