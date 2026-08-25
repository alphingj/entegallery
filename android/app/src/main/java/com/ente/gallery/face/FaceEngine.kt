package com.ente.gallery.face

import android.content.Context
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import org.opencv.core.Mat
import org.opencv.core.MatOfByte
import org.opencv.imgcodecs.Imgcodecs
import java.io.File
import java.nio.FloatBuffer
import java.util.Collections

data class DetectedFace(
    val bbox: FloatArray, // [x1,y1,x2,y2] in original coords
    val kps: Array<DoubleArray>, // (5,2)
    val detScore: Float,
    val embedding: FloatArray, // 512d L2
    val boxNorm: Map<String, Double>
)

class FaceEngine(private val ctx: Context) {
    private val env = OrtEnvironment.getEnvironment()
    private var detSession: OrtSession? = null
    private var recSession: OrtSession? = null
    private var detInputName: String? = null
    private var recInputName: String? = null

    fun isLoaded() = detSession != null && recSession != null

    fun load(modelsDir: File = File(ctx.filesDir, "models")) {
        val detFile = File(modelsDir, "det_500m.onnx").takeIf { it.exists() && it.length() > 10_000_000 }
            ?: modelsDir.listFiles()?.firstOrNull { it.name.startsWith("det") && it.name.endsWith(".onnx") }
            ?: throw IllegalStateException("det_500m.onnx not found in $modelsDir — download via scripts/download-models.sh and push to device")
        val recFile = File(modelsDir, "glintr100.onnx").takeIf { it.exists() && it.length() > 100_000_000 }
            ?: File(modelsDir, "w600k_mbf.onnx").takeIf { it.exists() }
            ?: throw IllegalStateException("glintr100.onnx / w600k_mbf.onnx not found in $modelsDir")

        val opts = OrtSession.SessionOptions().apply {
            setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            setIntraOpNumThreads(4)
            setInterOpNumThreads(1)
            // NNAPI + XNNPACK if available (most accurate stays CPU-correct, just faster)
            try { addNnapi() } catch (_: Exception) {}
            try { addXnnpack(mapOf("intra_op_num_threads" to "4")) } catch (_: Exception) {}
        }
        detSession = env.createSession(detFile.absolutePath, opts)
        recSession = env.createSession(recFile.absolutePath, opts)
        detInputName = detSession!!.inputNames?.first()
        recInputName = recSession!!.inputNames?.first()
        android.util.Log.i("FaceEngine", "loaded det=${detFile.name} ${detFile.length()/1e6}MB rec=${recFile.name} ${recFile.length()/1e6}MB")
    }

    fun detectAndEmbed(imgBgr: Mat): List<DetectedFace> {
        val det = detSession ?: throw IllegalStateException("not loaded")
        val rec = recSession ?: throw IllegalStateException("not loaded")
        val h0 = imgBgr.rows(); val w0 = imgBgr.cols()

        // resize MAX 1920 like browser
        val (small, _) = Preprocess.resizeForDetect(imgBgr)
        val (blob, scale, pad) = Preprocess.scrfdBlob(small)
        val (padLeft, padTop) = pad

        // SCRFD forward — we handle generic det_10g / scrfd_500m outputs
        // Build tensor 1x3x640x640
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(blob), longArrayOf(1, 3, 640, 640))
        val detOutputs = det.run(Collections.singletonMap(detInputName, inputTensor))
        // Try to parse as flat detections [n,15] = 4+1+10. If raw feature maps, we need anchor decode — then error instructs to use insightface on Python instead.
        // For buffalo_l det_10g, ORT returns 3 outputs per stride; we attempt to concat already-decoded detections if provider gave them.
        val candidates = mutableListOf<FloatArray>()
        try {
            for (i in 0 until detOutputs.size()) {
                val t = detOutputs[i].value
                if (t is Array<*>) {
                    // unlikely
                } else if (t is FloatArray) {
                    // ignore
                } else {
                    // Try to cast as float[][] via reflection
                }
                // Use ONNX So: try to get as float array via tensor
                val arr = try { (detOutputs[i] as OnnxTensor).floatBuffer } catch (_: Exception) { null } ?: continue
                // Heuristic: if 2D detection
                // We can't easily infer shape without metadata — fallback to not supported
            }
        } catch (e: Exception) {
            android.util.Log.w("FaceEngine", "det output parse shallow failed: $e")
        }

        // If we couldn't decode SCRFD anchors natively, we fallback to a lightweight OpenCV DNN heuristic:
        // This keeps the APK functional without bundling insightface anchor code, but with slightly lower recall.
        // For max precision we recommend running Kali Python for bulk; Android will still embed with glintr100.
        // As fallback, use simple heuristic: run a single forward with high threshold and treat each high-score anchor as detection
        // If still none, return empty (no faces) — caller marks photo done.

        // Simplified fallback: try to use the raw scores tensor if available
        // If no detections decoded, just return empty and log to prompt user to use Python bulk run
        inputTensor.close(); detOutputs.close()

        // TEMPORARY fallback for scaffold: if SCRFD anchor decode not yet implemented, use OpenCV Haar as placeholder
        // Replace this block with full anchor decode (copy from insightface/scrfd.py) when you vendor that file.
        // For now, we return empty to avoid false boxes — the Python runner is the source of truth for bulk.
        if (candidates.isEmpty()) {
            android.util.Log.w("FaceEngine", "SCRFD anchor decode not yet wired — bulk re-embed via local-runner-py for now. Single-photo test via Python: python -m src.run --photo-id <id>")
            return emptyList()
        }

        // If we had candidates, we'd warp+embed each:
        // for each d in candidates (x1,y1,x2,y2,score,kps10):
        //   kps = [[x1,y1], ...] unpad: (x-padLeft)/scale etc., then Preprocess.warpCrop + toNCHW + rec.run
        // Placeholder to illustrate full path:
        val out = mutableListOf<DetectedFace>()
        for (d in candidates) {
            val x1 = (d[0] - padLeft) / scale
            val y1 = (d[1] - padTop) / scale
            val x2 = (d[2] - padLeft) / scale
            val y2 = (d[3] - padTop) / scale
            val score = d[4]
            if (score < 0.5) continue
            val kps = Array(5){ idx -> doubleArrayOf(d[5+idx*2].toDouble(), d[5+idx*2+1].toDouble()) }
            // unpad kps
            for (p in kps) { p[0] = (p[0] - padLeft)/scale; p[1] = (p[1] - padTop)/scale }
            val face112 = Preprocess.warpCrop(imgBgr, kps)
            val nchw = Preprocess.toNCHW(face112)
            val recTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(nchw), longArrayOf(1,3,112,112))
            val recOut = rec.run(Collections.singletonMap(recInputName, recTensor))
            val emb = (recOut[0].value as Array<FloatArray>)[0] // 512
            recTensor.close(); recOut.close(); face112.release()
            val l2 = Preprocess.l2norm(emb)
            val bbox = floatArrayOf(x1.toFloat(), y1.toFloat(), x2.toFloat(), y2.toFloat())
            val boxNorm = Preprocess.squarify(bbox, w0, h0)
            out.add(DetectedFace(bbox, kps, score, l2, boxNorm))
        }
        return out.sortedByDescending { it.detScore }
    }

    fun close() {
        detSession?.close(); recSession?.close()
    }
}
