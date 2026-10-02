package app.isabella.mermaid;

import android.app.Activity;
import android.webkit.WebView;

/** Family flavor: her app exactly as before. No wallet bridge; every hook is a no-op. */
final class Flavor {
    Flavor(Activity activity, WebView web) { }
    void onResume() { }
    void onPause() { }
    void onDestroy() { }
    boolean onActivityResult(int requestCode, int resultCode) { return false; }
}
