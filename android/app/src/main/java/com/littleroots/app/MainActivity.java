package com.littleroots.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** LittleRoots for Android phones, tablets and Android TV: shows the live LittleRoots app full screen. */
public class MainActivity extends Activity {
    static final String HOST = "littleroots-api.littlerootsstudios.workers.dev";
    static final String OFFLINE = "file:///android_asset/offline.html";

    private WebView web;
    private String appUrl;
    private View fullView;
    private WebChromeClient.CustomViewCallback fullCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        boolean tv = getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
        appUrl = "https://" + HOST + "/?tvapp=1&platform=android" + (tv ? "" : "&touch=1");

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0D322C"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " LittleRootsAndroid/1.0");
        web.addJavascriptInterface(new Bridge(), "LRAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String h = u.getHost() == null ? "" : u.getHost();
                if (h.equals(HOST) || "file".equals(u.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* no browser */ }
                return true; // other websites open outside the app
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) view.loadUrl(OFFLINE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() { // lets videos go full screen if they ask to
            @Override public void onShowCustomView(View v, CustomViewCallback cb) {
                fullView = v; fullCallback = cb;
                ((FrameLayout) getWindow().getDecorView()).addView(v, new FrameLayout.LayoutParams(-1, -1));
            }
            @Override public void onHideCustomView() { leaveFullView(); }
        });

        setContentView(web);
        if (saved != null) web.restoreState(saved); else web.loadUrl(appUrl);
    }

    private void leaveFullView() {
        if (fullView == null) return;
        ((FrameLayout) getWindow().getDecorView()).removeView(fullView);
        fullView = null;
        if (fullCallback != null) fullCallback.onCustomViewHidden();
    }

    /** Back button: the app decides (close the player, close a page, "press Back again to leave"). */
    @Override
    public void onBackPressed() {
        if (fullView != null) { leaveFullView(); return; }
        web.evaluateJavascript("window.lrBack ? String(lrBack()) : 'none'", v -> {
            if (v == null || v.contains("none")) {
                if (web.canGoBack() && !OFFLINE.equals(web.getUrl())) web.goBack(); else finish();
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }

    /** Called from the app's JavaScript as window.LRAndroid */
    class Bridge {
        @JavascriptInterface public void exit() { runOnUiThread(MainActivity.this::finish); }
        @JavascriptInterface public void retry() { runOnUiThread(() -> web.loadUrl(appUrl)); }
    }
}
