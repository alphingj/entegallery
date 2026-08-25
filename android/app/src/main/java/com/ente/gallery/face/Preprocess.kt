package com.ente.gallery.face

import org.opencv.android.Utils
import org.opencv.core.*
import org.opencv.imgproc.Imgproc
import android.graphics.Bitmap

/**
 * Mirrors local-runner-py/src/face/preprocess.py + insight-client.ts:138..167
 * Template for ArcFace 112x112
 */
object Preprocess {
    val TEMPLATE = arrayOf(
        doubleArrayOf(38.2946, 51.6963),
        doubleArrayOf(73.5318, 51.5014),
        doubleArrayOf(56.0252, 71.7366),
        doubleArrayOf(41.5493, 92.3655),
        doubleArrayOf(70.7299, 92.2041)
    )
    const val MAX_DIM = 1920

    fun resizeForDetect(mat: Mat): Pair<Mat, Double> {
        val h = mat.rows(); val w = mat.cols()
        val scale = minOf(1.0, MAX_DIM / maxOf(h, w).toDouble())
        if (scale >= 1.0) return mat to 1.0
        val dst = Mat()
        Imgproc.resize(mat, dst, Size(w*scale, h*scale))
        return dst to scale
    }

    // Estimate similarity transform 5 pts -> TEMPLATE, then warpAffine 112x112
    fun warpCrop(imgBgr: Mat, kps: Array<DoubleArray>): Mat {
        val src = MatOfPoint2f(*kps.map { Point(it[0], it[1]) }.toTypedArray())
        val dst = MatOfPoint2f(*TEMPLATE.map { Point(it[0], it[1]) }.toTypedArray())
        val M = Imgproc.estimateAffinePartial2D(src, dst)
        val warped = Mat()
        Imgproc.warpAffine(imgBgr, warped, M, Size(112.0, 112.0), Imgproc.INTER_LINEAR, Imgproc.BORDER_CONSTANT, Scalar(0.0,0.0,0.0))
        src.release(); dst.release(); M.release()
        return warped
    }

    // BGR 112x112 -> float32 CHW (x-127.5)/127.5 RGB
    fun toNCHW(warpedBgr: Mat): FloatArray {
        // BGR->RGB
        val rgb = Mat()
        Imgproc.cvtColor(warpedBgr, rgb, Imgproc.COLOR_BGR2RGB)
        val chw = FloatArray(3*112*112)
        var p = 0
        // planar: iterate c,y,x and sample
        for (c in 0 until 3) {
            for (y in 0 until 112) {
                for (x in 0 until 112) {
                    val v = rgb.get(y, x)[c] // but get returns BGR? after conversion it's RGB so get[y,x][c] is channel c (R=0)
                    chw[p++] = ((v - 127.5) / 127.5).toFloat()
                }
            }
        }
        rgb.release()
        return chw
    }

    // SCRFD 640 preprocess: letterbox + normalize
    fun scrfdBlob(imgBgr: Mat): Triple<FloatArray, Double, Pair<Int,Int>> {
        val h = imgBgr.rows(); val w = imgBgr.cols()
        val scale = minOf(640.0/h, 640.0/w)
        val nh = (h*scale).toInt(); val nw = (w*scale).toInt()
        val resized = Mat()
        Imgproc.resize(imgBgr, resized, Size(nw.toDouble(), nh.toDouble()))
        val canvas = Mat(640, 640, CvType.CV_8UC3, Scalar(114.0,114.0,114.0))
        val top = (640 - nh)/2; val left = (640 - nw)/2
        val roi = canvas.submat(top, top+nh, left, left+nw)
        resized.copyTo(roi)
        // BGR->RGB, (x-127.5)/127.5, CHW
        val rgb = Mat(); Imgproc.cvtColor(canvas, rgb, Imgproc.COLOR_BGR2RGB)
        val chw = FloatArray(3*640*640)
        var p=0
        for (c in 0 until 3) for (y in 0 until 640) for (x in 0 until 640) {
            chw[p++] = ((rgb.get(y,x)[c] - 127.5)/127.5).toFloat()
        }
        resized.release(); canvas.release(); roi.release(); rgb.release()
        return Triple(chw, scale, left to top)
    }

    fun squarify(box: FloatArray, imgW: Int, imgH: Int): Map<String, Double> {
        var x1 = box[0].toDouble(); var y1 = box[1].toDouble(); var x2 = box[2].toDouble(); var y2 = box[3].toDouble()
        val width = x2 - x1; val height = y2 - y1
        val size = maxOf(width, height)
        val cx = x1 + width/2; val cy = y1 + height/2
        var x = cx - size/2; var y = cy - size/2
        x = maxOf(0.0, x); y = maxOf(0.0, y)
        val pw = minOf(imgW - x, size.toDouble()); val ph = minOf(imgH - y, size.toDouble())
        return mapOf("x" to x / imgW, "y" to y / imgH, "width" to maxOf(pw,1.0)/imgW, "height" to maxOf(ph,1.0)/imgH)
    }

    fun l2norm(v: FloatArray): FloatArray {
        var s = 0.0
        for (x in v) s += x*x
        val n = Math.sqrt(s)
        return if (n==0.0) v else FloatArray(v.size){ (v[it]/n).toFloat() }
    }
}
