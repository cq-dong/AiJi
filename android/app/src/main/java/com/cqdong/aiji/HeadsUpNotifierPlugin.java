package com.cqdong.aiji;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 高优先级本地通知插件（heads-up 横幅）。
 *
 * 为什么不用 @capacitor/local-notifications：
 *   其 buildNotification 写死 setPriority(PRIORITY_DEFAULT)（LocalNotificationManager.java:173），
 *   Android 8+ 虽说 priority 由 channel 决定，但 OEM ROM（小米/华为/OPPO/vivo）常仍看
 *   notification.priority 决定是否弹 heads-up 横幅 → 通知只响铃不弹横幅。
 *   该插件源码在 node_modules 无法改，故自建。
 *
 * 本插件：
 *   - channel 'reminders' importance=HIGH（删后重建强制刷新，绕过 importance 不可变限制）
 *   - 通知 NotificationCompat.PRIORITY_HIGH + category=reminder
 *   - AlarmManager setExact（需 USE_EXACT_ALARM/SCHEDULE_EXACT_ALARM，manifest 已加）排程未来到点
 *   - 到点 BroadcastReceiver 构建并发出 PRIORITY_HIGH 通知 → heads-up 横幅
 *
 * app 前台/后台/被杀均触发（AlarmManager 系统级）。被杀后重启由系统补投（PendingIntent.FLAG_IMMUTABLE）。
 */
@CapacitorPlugin(name = "HeadsUpNotifier")
public class HeadsUpNotifierPlugin extends Plugin {

    private static final String CHANNEL_ID = "reminders";
    private static final String ACTION_FIRE = "com.cqdong.aiji.FIRE_REMINDER";
    private static final String EXTRA_ID = "notifId";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_BODY = "body";

    /** 创建/重建 channel。importance 不可变 → 先删后建强制 HIGH。 */
    @PluginMethod
    public void ensureChannel(PluginCall call) {
        ensureChannel();
        call.resolve();
    }

    /** 即时发一条 heads-up 通知（前台到点路径）。 */
    @PluginMethod
    public void notifyNow(PluginCall call) {
        String title = call.getString("title", "AiJi 提醒");
        String body = call.getString("body", "");
        int id = (int) call.getInt("id", System.currentTimeMillis() % Integer.MAX_VALUE);
        ensureChannel();
        postNotification(id, title, body);
        call.resolve();
    }

    /** 排程未来到点通知（后台/被杀路径）。 */
    @PluginMethod
    public void schedule(PluginCall call) {
        String title = call.getString("title", "AiJi 提醒");
        String body = call.getString("body", "");
        int id = (int) call.getInt("id", System.currentTimeMillis() % Integer.MAX_VALUE);
        long at = call.getLong("at", 0L);
        if (at <= 0) {
            call.reject("at (epoch ms) is required");
            return;
        }
        ensureChannel();
        Context ctx = getContext();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            call.reject("AlarmManager unavailable");
            return;
        }

        Intent intent = new Intent(ctx, HeadsUpReceiver.class)
                .setAction(ACTION_FIRE)
                .putExtra(EXTRA_ID, id)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_BODY, body);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(ctx, id, intent, flags);

        // 先取消同 id 旧预约（reschedule 场景）
        am.cancel(pi);

        long triggerAt = at;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                // 无 exact 权限 → 退化非精确（可能延迟，但至少触发）
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
        call.resolve();
    }

    /** 取消已排程通知。 */
    @PluginMethod
    public void cancel(PluginCall call) {
        int id = (int) call.getInt("id", 0);
        Context ctx = getContext();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            Intent intent = new Intent(ctx, HeadsUpReceiver.class).setAction(ACTION_FIRE);
            int flags = PendingIntent.FLAG_NO_CREATE;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getBroadcast(ctx, id, intent, flags);
            if (pi != null) am.cancel(pi);
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(id);
        call.resolve();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // importance 不可变：删后重建强制 HIGH
        try {
            nm.deleteNotificationChannel(CHANNEL_ID);
        } catch (Exception ignored) {
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "提醒", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("AiJi 待办提醒通知");
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        channel.enableVibration(true);
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);
    }

    private void postNotification(int id, String title, String body) {
        Context ctx = getContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH) // 关键：heads-up 横幅
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true);
        nm.notify(id, b.build());
    }

    /** 供 HeadsUpReceiver 调用的静态 post（receiver 无 plugin 实例）。 */
    public static void postFromReceiver(Context ctx, int id, String title, String body) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
            if (existing == null || existing.getImportance() < NotificationManager.IMPORTANCE_HIGH) {
                try { nm.deleteNotificationChannel(CHANNEL_ID); } catch (Exception ignored) {}
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID, "提醒", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("AiJi 待办提醒通知");
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                channel.enableVibration(true);
                channel.setShowBadge(true);
                nm.createNotificationChannel(channel);
            }
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true);
        nm.notify(id, b.build());
    }
}
