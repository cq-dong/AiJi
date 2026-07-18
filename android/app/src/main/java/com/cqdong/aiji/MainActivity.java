package com.cqdong.aiji;

import android.os.Bundle;
import android.view.View;
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
        super.onCreate(savedInstanceState);
        // D1/D2: Edge-to-edge —— 内容延伸到系统栏后面，手动注入 insets 给 WebView。
        // env(safe-area-inset-*) 是 iOS WebKit 特性，Android WebView 不自动提供（inset 恒为 0），
        // 必须在原生层把 systemBars insets 转成 CSS 变量 --safe-top / --safe-bottom 注入 documentElement，
        // 前端用 var(--safe-*) 替代 env()。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View root = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            int top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top;
            int bottom = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom;
            String js = "document.documentElement.style.setProperty('--safe-top','" + top + "px');"
                      + "document.documentElement.style.setProperty('--safe-bottom','" + bottom + "px');";
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().evaluateJavascript(js, null);
            }
            return insets;
        });
    }
}
