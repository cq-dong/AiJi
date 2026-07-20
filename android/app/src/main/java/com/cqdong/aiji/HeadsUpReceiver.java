package com.cqdong.aiji;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * AlarmManager 到点触发的接收器：构建并发 PRIORITY_HIGH 通知（heads-up 横幅）。
 * app 前台/后台/被杀均触发（AlarmManager RTC_WAKEUP 唤醒）。
 */
public class HeadsUpReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra("notifId", (int) System.currentTimeMillis());
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        if (title == null) title = "AiJi 提醒";
        if (body == null) body = "";
        HeadsUpNotifierPlugin.postFromReceiver(context, id, title, body);
    }
}
