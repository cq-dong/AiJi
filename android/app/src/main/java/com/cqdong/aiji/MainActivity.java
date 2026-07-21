package com.cqdong.aiji;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import androidx.core.view.WindowCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // D12: AndroidX SplashScreen API —— 必须在 super.onCreate 之前 install，
        // 否则 Android 12+ 系统接管 splash 只显示默认，自定义 splash 资源被绕过。
        SplashScreen.installSplashScreen(this);
        // 自定义插件必须在 super.onCreate 之前 register，否则 bridge 初始化时拿不到。
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(HeadsUpNotifierPlugin.class);
        super.onCreate(savedInstanceState);
        // 后端跑在 http://106.54.26.195（暂无域名/HTTPS）。WebView 起自 androidScheme:https
        // → origin 为 https://localhost，向 http 后端发起 fetch 属 mixed content（https 页→http 资源）。
        // Android WebView 默认阻拦 → 后端 API 全挂。开 MIXED_CONTENT_ALWAYS_ALLOW 放行。
        // 相比全局开 CapacitorHttp（reroute 所有 fetch）更外科：只动 mixed-content 策略，
        // 不碰 fetch 路径，规避 rc14 enabled:true 引入的 403 回归。CORS 已在 server 放行 https://localhost。
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        // D1/D2: Edge-to-edge —— 内容延伸到系统栏后面，手动注入 insets 给 WebView。
        // env(safe-area-inset-*) 是 iOS WebKit 特性，Android WebView 不自动提供（inset 恒为 0），
        // 必须在原生层把 systemBars insets 转成 CSS 变量 --safe-top / --safe-bottom 注入 documentElement，
        // 前端用 var(--safe-*) 替代 env()。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // D26: WindowInsetsCompat 返回的是设备像素（device px），而 CSS `px` 是密度无关像素
        // （1 CSS px = density 个 device px）。直接把 device px 当 CSS px 注入会让高密度屏
        // （density=3）的 100dp 状态栏变成 100 CSS px = 300 device px 的留白，上下各被撑出
        // 3 倍空白。必须除以 displayMetrics.density 换算成 CSS px 再注入。
        final float density = getResources().getDisplayMetrics().density;
        View root = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            int top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top;
            int bottom = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom;
            int topCss = Math.round(top / density);
            int bottomCss = Math.round(bottom / density);
            String js = "document.documentElement.style.setProperty('--safe-top','" + topCss + "px');"
                      + "document.documentElement.style.setProperty('--safe-bottom','" + bottomCss + "px');";
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().evaluateJavascript(js, null);
            }
            return insets;
        });
    }
}
