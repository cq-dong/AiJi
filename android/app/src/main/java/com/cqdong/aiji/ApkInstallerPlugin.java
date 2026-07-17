package com.cqdong.aiji;

import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 应用内自更新插件：下载 APK 到 app cache → FileProvider 取 content:// URI →
 * ACTION_VIEW + application/vnd.android.package-archive 拉起系统安装器。
 *
 * 为什么不走 WebView fetch：GitHub release 资产下载经 github.com→
 * objects.githubusercontent.com 重定向，后者不发 CORS 头，WebView fetch 必失败；
 * 原生 HttpURLConnection 不受 CORS 限，且直写文件免 base64 膨胀内存。
 *
 * 需 manifest: REQUEST_INSTALL_PACKAGES 权限 + FileProvider（capacitor 模板自带，
 * authorities=${applicationId}.fileprovider，file_paths.xml 已暴露 cache-path）。
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        // 下载在后台线程，避免阻塞 Capacitor bridge 线程。
        // 注意：call.reject/resolve 必须经 bridge.execute 回到 bridge 专属线程——
        // Capacitor 8 的 savedCalls 是非同步 HashMap，后台线程直接调 reject/resolve
        // 会与 saveCall 竞争导致 HashMap 损坏/丢回调/崩溃（并发双击或重试时触发）。
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true); // GitHub 资产 302 到 CDN
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(30000);
                conn.connect();
                if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) {
                    final int code = conn.getResponseCode();
                    bridge.execute(() -> call.reject("download failed: HTTP " + code));
                    return;
                }

                // 唯一文件名防并发下载互覆盖致 APK 损坏。
                File outFile = new File(getContext().getCacheDir(),
                        "aiji-update-" + System.currentTimeMillis() + ".apk");
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                }

                // FileProvider 取 content:// —— cache-path 已在 file_paths.xml 暴露。
                Uri uri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        outFile);

                Intent intent = new Intent(Intent.ACTION_VIEW);
                String mime = MimeTypeMap.getSingleton()
                        .getMimeTypeFromExtension("apk");
                intent.setDataAndType(uri, mime != null ? mime : "application/vnd.android.package-archive");
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                // FileProvider URI 必须授读写权限给安装器，否则安装器读不到 APK。
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                bridge.execute(() -> {
                    try {
                        // Capacitor 8 的 Plugin 基类不暴露 startActivity(Intent)；
                        // 经 getContext() 拿 Context 再调（Activity Context，FLAG_ACTIVITY_NEW_TASK 已设）。
                        getContext().startActivity(intent);
                        call.resolve(new JSObject());
                    } catch (Exception e) {
                        call.reject("launch installer failed: " + e.getMessage());
                    }
                });
            } catch (Exception e) {
                final String msg = e.getMessage();
                bridge.execute(() -> call.reject("download failed: " + msg));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}
