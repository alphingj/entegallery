package com.ente.gallery

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class EnteApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel("face_scan", "Face Scan", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Ente re-embedding progress"
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }
}
