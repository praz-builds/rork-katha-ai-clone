package com.rork.kathaai.viewmodel

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.rork.kathaai.MainActivity
import com.rork.kathaai.R
import com.rork.kathaai.model.StreakState
import kotlinx.serialization.json.Json

class StreakReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val prefs = context.getSharedPreferences("katha", Context.MODE_PRIVATE)
        val raw = prefs.getString("streak", null) ?: return
        val streak = runCatching { Json { ignoreUnknownKeys = true }.decodeFromString<StreakState>(raw) }.getOrNull() ?: return
        if (streak.current <= 0) return
        val launchIntent = PendingIntent.getActivity(context, 1203, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, "katha_progress")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Your ${streak.current}-day streak needs saving")
            .setContentText("Read one story tonight to keep it alive 🔥")
            .setContentIntent(launchIntent)
            .setAutoCancel(true)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(1204, notification)
    }
}
