package app.isabella.mermaid;

import android.app.Activity;
import android.webkit.WebView;

/** Store flavor: adds window.IsabellaWallet (Mobile Wallet Adapter) and feeds it the activity lifecycle. */
final class Flavor {
    private final WalletBridge wallet;

    Flavor(Activity activity, WebView web) {
        wallet = new WalletBridge(activity, web);
        web.addJavascriptInterface(wallet, "IsabellaWallet");
    }

    void onResume() { wallet.onResume(); }
    void onPause() { wallet.onPause(); }
    void onDestroy() { wallet.onDestroy(); }
    boolean onActivityResult(int requestCode, int resultCode) { return wallet.onActivityResult(requestCode, resultCode); }
}
