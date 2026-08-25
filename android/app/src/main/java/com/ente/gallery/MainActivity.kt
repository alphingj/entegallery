package com.ente.gallery

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.ente.gallery.data.SupabaseRepo
import com.ente.gallery.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var running = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnScan.setOnClickListener { if (!running) startScan(all = false) }
        binding.btnScanAll.setOnClickListener { if (!running) startScan(all = true) }
        binding.btnDownloadModels.setOnClickListener { downloadModels() }

        // show model status
        val modelsDir = File(filesDir, "models")
        val det = File(modelsDir, "det_500m.onnx")
        val rec = File(modelsDir, "glintr100.onnx")
        binding.modelStatus.text = "models: det=${if(det.exists()) "${det.length()/1e6}MB" else "MISSING"} rec=${if(rec.exists()) "${rec.length()/1e6}MB" else "MISSING"} (place in ${modelsDir.absolutePath})"
    }

    private fun downloadModels() {
        Toast.makeText(this, "Pull from https://huggingface.co/deepinsight/insightface — or adb push ../public/models/insight/*.onnx to ${filesDir}/models/", Toast.LENGTH_LONG).show()
        // TODO: implement streaming download with OkHttp + progress (like download-models.sh)
        // val url = "https://huggingface.co/deepinsight/insightface/resolve/main/models/antelopev2/glintr100.onnx"
    }

    private fun startScan(all: Boolean) {
        running = true
        binding.progress.text = "Starting..."
        val intent = android.content.Intent(this, FaceScanService::class.java).apply {
            putExtra("all", all)
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else startService(intent)
        // observe via WorkManager or service notification
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                // quick count check
                try {
                    val repo = SupabaseRepo(this@MainActivity)
                    val pending = if (all) repo.fetchAll(limit = 1) else repo.fetchPending(1)
                    withContext(Dispatchers.Main) { binding.progress.text = "Queued ${if(all) "ALL" else "PENDING"} — see notification" }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { binding.progress.text = "Supabase error: ${e.message} — check SECURITY.md RLS" }
                }
            }
        }
    }
}
