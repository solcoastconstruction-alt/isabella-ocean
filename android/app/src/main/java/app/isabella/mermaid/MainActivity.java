package app.isabella.mermaid;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

/**
 * A full-screen WebView that plays the game in assets/index.html.
 * Flavor (src/family or src/store) adds what differs per build: the store build's wallet bridge.
 */
public class MainActivity extends Activity {
    private WebView web;
    private Flavor flavor;

    /** Saves progress (unlocked levels, stars, gold) in SharedPreferences. */
    static class Store {
        private final SharedPreferences prefs;
        Store(SharedPreferences p) { prefs = p; }
        @JavascriptInterface public String get(String key) { return prefs.getString(key, null); }
        @JavascriptInterface public void set(String key, String value) { prefs.edit().putString(key, value).apply(); }
    }

    /** Lets the title screen offer "Add to Home screen" (window.IsabellaApp). */
    class AppBridge {
        @JavascriptInterface public boolean canPin() {
            ShortcutManager sm = getSystemService(ShortcutManager.class);
            return sm != null && sm.isRequestPinShortcutSupported();
        }
        @JavascriptInterface public boolean isPinned() {
            ShortcutManager sm = getSystemService(ShortcutManager.class);
            if (sm == null) return false;
            for (ShortcutInfo i : sm.getPinnedShortcuts()) if ("play".equals(i.getId()) && i.isEnabled()) return true;
            return false;
        }
        @JavascriptInterface public void pinToHome() { runOnUiThread(MainActivity.this::requestPin); }
        /** Opens one of the game's own web pages (privacy policy, terms) in the browser; nothing else. */
        @JavascriptInterface public boolean openUrl(String url) {
            if (url == null || !url.startsWith("https://isabellaocean-app.pages.dev/")) return false;
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { Log.w("Isabella", "no browser for " + url); }
            });
            return true;
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(0xFF1F8FC0);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        web.addJavascriptInterface(new Store(getSharedPreferences("isabella", MODE_PRIVATE)), "IsabellaStore");
        web.addJavascriptInterface(new AppBridge(), "IsabellaApp");
        flavor = new Flavor(this, web);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i("Isabella", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(startPage(getIntent()));

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        maybePinToHome(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (BuildConfig.DEBUG && intent.hasExtra("page")) web.loadUrl(startPage(intent));
        maybePinToHome(intent);
    }

    /**
     * The game, or in debug builds only a test page from the assets:
     * adb shell am start -n &lt;package&gt;/app.isabella.mermaid.MainActivity --es page wallet-test.html
     */
    private static String startPage(Intent intent) {
        if (BuildConfig.DEBUG && intent != null) {
            String page = intent.getStringExtra("page");
            if (page != null && page.matches("[A-Za-z0-9_-]+\\.html")) return "file:///android_asset/" + page;
        }
        return "file:///android_asset/index.html";
    }

    /** Started with --ez pin true: same as the title screen's "Add to Home screen" button. */
    private void maybePinToHome(Intent intent) {
        if (intent != null && intent.getBooleanExtra("pin", false)) requestPin();
    }

    /** Ask the launcher to put an Isabella icon on the home screen (Android shows its own prompt). */
    private void requestPin() {
        ShortcutManager sm = getSystemService(ShortcutManager.class);
        if (sm == null || !sm.isRequestPinShortcutSupported()) return;
        Intent launch = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setClassName(this, MainActivity.class.getName());
        ShortcutInfo info = new ShortcutInfo.Builder(this, "play")
                .setShortLabel(getString(R.string.app_name))
                .setLongLabel(getString(R.string.shortcut_long_label))
                .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
                .setIntent(launch)
                .build();
        sm.requestPinShortcut(info, null);
    }

    private void handleBack() {
        web.evaluateJavascript("window.__back ? window.__back() : false", v -> {
            if (!"true".equals(v)) finish();
        });
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { handleBack(); }

    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override
    protected void onPause() {
        flavor.onPause();
        web.evaluateJavascript("window.__pause && window.__pause()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideBars();
        web.evaluateJavascript("window.__pinState && window.__pinState()", null); // after the Add prompt
        flavor.onResume();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (!flavor.onActivityResult(requestCode, resultCode)) super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        flavor.onDestroy();
        super.onDestroy();
    }
}
