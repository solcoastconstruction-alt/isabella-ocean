package app.isabella.mermaid;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.solana.mobilewalletadapter.clientlib.protocol.JsonRpc20Client.JsonRpc20RemoteException;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.AuthorizationResult;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.NotSubmittedException;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.SignAndSendTransactionsResult;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterSession;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationIntentCreator;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario;
import com.solana.mobilewalletadapter.common.ProtocolContract;
import com.solana.mobilewalletadapter.common.protocol.SessionProperties;
import com.solana.mobilewalletadapter.common.util.Base58;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * window.IsabellaWallet: Contract 1 in docs/kids-bundle/BUILD-PLAN.md, on Mobile Wallet Adapter 2.
 *
 * Sync:  available() returns the STRING "true" or "false"; savedPublicKey(chain) returns base58 or "";
 *        disconnect(chain) forgets the saved auth token and key.
 * Async: connect(id, chain) and signAndSend(id, chain, txsJson) return at once. The answer comes later as
 *        window.__walletResult(id, json) on the UI thread, where json is a JSON STRING:
 *        {ok:true, publicKey, walletLabel} | {ok:true, signatures:[base58]} | {ok:false, error, cancelled}.
 *        An integer id comes back as a number; any other id comes back as a string. A failed signAndSend
 *        carries maybeSubmitted:true when the wallet had the transactions but never answered: check the chain
 *        before offering a retry.
 *
 * Each async call is one MWA session: the wallet's screen opens, we authorize (silently when the saved
 * token still works), make the request, then close. The work runs on one background thread and only one
 * call may be open at a time; a second call answers {ok:false, error:"busy…"} straight away.
 * Answers that arrive while the app is in the background are held until it is in front again.
 *
 * Timing: while the wallet is in front Android may FREEZE this process (cached-app freezer; seen after ~70 s
 * on the API 36 emulator). A frozen process cannot read the wallet's answer, and any timer runs late, so a
 * request timer would fire at thaw and race the answer already waiting in the socket. There is therefore
 * no per-request timer: a call ends when the wallet answers, when the wallet drops the session, or a few
 * seconds after the parent is back in this app without an answer (onResume). A 10-minute backstop remains.
 */
final class WalletBridge {
    private static final String TAG = "Isabella";
    private static final int REQUEST_WALLET = 0x15AB;

    // Contract 1 identity. The wallet resolves the relative icon against the identity URI.
    // The wallet verifies this identity against https://isabellaocean-app.pages.dev/.well-known/assetlinks.json
    // (package + signing-cert SHA-256; site source in site/). The icon path is relative to the URI.
    private static final Uri IDENTITY_URI = Uri.parse("https://isabellaocean-app.pages.dev");
    private static final Uri ICON_URI = Uri.parse("icon.png");
    private static final String IDENTITY_NAME = "Isabella Ocean";
    private static final String DEVNET = "solana:devnet", MAINNET = "solana:mainnet";

    private static final long FOREGROUND_WAIT_MS = 20_000;  // the wallet can only be opened while we are in front
    private static final long LAUNCH_WAIT_MS = 5_000;
    private static final long CONNECT_WAIT_MS = 40_000;     // backstop: the library gives up by itself after ~30 s
    private static final int LIBRARY_REQUEST_TIMEOUT_MS = 0; // none; see "Timing" above
    private static final long REQUEST_BACKSTOP_MS = 10 * 60_000;
    private static final long CLOSE_WAIT_MS = 3_000;
    // Back in front with no answer yet (back button, app switch): how long an answer already on its way may take.
    private static final long BACK_GRACE_CONNECTED_MS = 8_000;
    private static final long BACK_GRACE_UNCONNECTED_MS = 3_000;

    private final Activity activity;
    private final WebView web;
    private final SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> new Thread(r, "IsabellaWallet"));
    private final AtomicBoolean busy = new AtomicBoolean();

    private final Object lifecycle = new Object();
    private boolean resumed, destroyed;                         // guarded by lifecycle
    private int resumeCount;                                    // UI thread
    private final List<String> undelivered = new ArrayList<>(); // UI thread
    private volatile Session session;                           // the call in flight, if any

    /** One association with the wallet app. */
    private static final class Session {
        final LocalAssociationScenario scenario = new LocalAssociationScenario(LIBRARY_REQUEST_TIMEOUT_MS);
        volatile boolean launched, leftUs, connected, done;
        volatile boolean abandoned;     // we were in front again and the wallet never answered, so we closed it
        volatile boolean signRequested; // the wallet has been handed the transactions
    }

    WalletBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.prefs = activity.getSharedPreferences("isabella-wallet", Activity.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- JavaScript API (Contract 1)

    @JavascriptInterface
    public String available() {
        return walletInstalled() ? "true" : "false";
    }

    @JavascriptInterface
    public String savedPublicKey(String chain) {
        return validChain(chain) ? prefs.getString(chain + ".publicKey", "") : "";
    }

    @JavascriptInterface
    public void disconnect(String chain) {
        if (!validChain(chain)) return;
        prefs.edit().remove(chain + ".authToken").remove(chain + ".publicKey").remove(chain + ".walletLabel").apply();
        Log.i(TAG, "wallet: forgot " + chain);
    }

    @JavascriptInterface
    public void connect(String id, String chain) {
        begin(id, chain, "connect", () -> doConnect(chain));
    }

    @JavascriptInterface
    public void signAndSend(String id, String chain, String txsJson) {
        begin(id, chain, "signAndSend", () -> doSignAndSend(chain, txsJson));
    }

    // ---------------------------------------------------------------- activity lifecycle (UI thread)

    void onResume() {
        synchronized (lifecycle) { resumed = true; lifecycle.notifyAll(); }
        final int n = ++resumeCount;
        for (String js : undelivered) web.evaluateJavascript(js, null);
        undelivered.clear();

        final Session s = session;
        if (s != null && s.launched && s.leftUs && !s.done) {
            // We are in front again but the wallet has not answered: the parent left the wallet without
            // choosing. Allow an answer already on its way a moment to arrive, then call it cancelled.
            ui.postDelayed(() -> {
                if (n == resumeCount && isResumed() && session == s && !s.done) {
                    Log.i(TAG, "wallet: back in the app without an answer; cancelling");
                    s.abandoned = true;
                    new Thread(s.scenario::close, "IsabellaWallet-close").start();
                }
            }, s.connected ? BACK_GRACE_CONNECTED_MS : BACK_GRACE_UNCONNECTED_MS);
        }
    }

    void onPause() {
        synchronized (lifecycle) { resumed = false; }
        final Session s = session;
        if (s != null && s.launched) s.leftUs = true;
    }

    void onDestroy() {
        synchronized (lifecycle) { destroyed = true; resumed = false; lifecycle.notifyAll(); }
        final Session s = session;
        if (s != null && !s.done) {
            s.abandoned = true;
            new Thread(s.scenario::close, "IsabellaWallet-close").start();
        }
        worker.shutdown();
        undelivered.clear();
    }

    /** The wallet's screen finished. onResume follows, and decides whether that means "cancelled". */
    boolean onActivityResult(int requestCode, int resultCode) {
        if (requestCode != REQUEST_WALLET) return false;
        Log.d(TAG, "wallet: wallet screen closed, result " + resultCode);
        return true;
    }

    // ---------------------------------------------------------------- the two calls

    private interface Job { JSONObject call() throws Exception; }

    private void begin(String id, String chain, String what, Job job) {
        if (!validChain(chain)) { deliver(id, fail("unsupported chain: " + chain)); return; }
        if (!busy.compareAndSet(false, true)) { deliver(id, fail("busy: another wallet request is still open")); return; }
        WalletKeepAlive.start(activity);   // no freezing while the parent is in the wallet
        try {
            worker.execute(() -> {
                JSONObject result;
                try {
                    result = job.call();
                } catch (Throwable t) {
                    result = describe(t);
                }
                WalletKeepAlive.stop(activity);
                busy.set(false);
                Log.i(TAG, "wallet: " + what + " " + chain + " -> " + summary(result));
                deliver(id, result);
            });
        } catch (RejectedExecutionException e) { // the activity is gone
            WalletKeepAlive.stop(activity);
            busy.set(false);
        }
    }

    private JSONObject doConnect(String chain) throws Exception {
        return withWallet((s, client, legacy) -> {
            final AuthorizationResult auth = authorize(client, legacy, chain, prefs.getString(chain + ".authToken", null));
            final String publicKey = Base58.encode(auth.accounts[0].publicKey);
            final String label = walletLabel(auth);
            prefs.edit().putString(chain + ".authToken", auth.authToken).putString(chain + ".publicKey", publicKey)
                    .putString(chain + ".walletLabel", label).commit();
            return json("ok", true, "publicKey", publicKey, "walletLabel", label);
        });
    }

    private JSONObject doSignAndSend(String chain, String txsJson) throws Exception {
        final byte[][] txs = transactions(txsJson);
        if (txs == null) return fail("txsJson must be a JSON array of base64 transactions");
        final String token = prefs.getString(chain + ".authToken", null);
        final String expected = prefs.getString(chain + ".publicKey", "");
        if (token == null || expected.isEmpty()) return fail("not connected: call connect first");

        return withWallet((s, client, legacy) -> {
            final AuthorizationResult auth = authorize(client, legacy, chain, token);
            if (!authorizes(auth, expected)) {
                // The wallet handed back a different account; the transactions name the old one as fee payer.
                final String now = Base58.encode(auth.accounts[0].publicKey);
                prefs.edit().putString(chain + ".authToken", auth.authToken).putString(chain + ".publicKey", now)
                        .putString(chain + ".walletLabel", walletLabel(auth)).commit();
                return put(fail("the wallet account changed: rebuild the transaction"), "publicKey", now);
            }
            prefs.edit().putString(chain + ".authToken", auth.authToken).commit();

            final SignAndSendTransactionsResult sent;
            try {
                s.signRequested = true;
                sent = await(client.signAndSendTransactions(txs, null, null, null, null, null), "signAndSend");
            } catch (WalletCallFailed e) {
                if (remoteCode(e) == ProtocolContract.ERROR_AUTHORIZATION_FAILED) {
                    prefs.edit().remove(chain + ".authToken").commit();
                }
                throw e;
            }
            final JSONArray signatures = new JSONArray();
            for (byte[] sig : sent.signatures) signatures.put(Base58.encode(sig));
            return json("ok", true, "signatures", signatures);
        });
    }

    /** authorize with the saved token if it still works; otherwise ask the wallet afresh (one prompt). */
    private AuthorizationResult authorize(MobileWalletAdapterClient client, boolean legacy, String chain, String token)
            throws Exception {
        if (token != null) {
            try {
                return await(legacy
                        ? client.reauthorize(IDENTITY_URI, ICON_URI, IDENTITY_NAME, token)
                        : client.authorize(IDENTITY_URI, ICON_URI, IDENTITY_NAME, chain, token, null, null, null),
                        "reauthorize");
            } catch (WalletCallFailed e) {
                if (remoteCode(e) != ProtocolContract.ERROR_AUTHORIZATION_FAILED) throw e;
                Log.i(TAG, "wallet: saved authorization not accepted; asking again");
            }
        }
        @SuppressWarnings("deprecation") // the cluster form is the only one a legacy (MWA 1.x) wallet understands
        final Future<AuthorizationResult> f = legacy
                ? client.authorize(IDENTITY_URI, ICON_URI, IDENTITY_NAME, DEVNET.equals(chain) ? "devnet" : "mainnet-beta")
                : client.authorize(IDENTITY_URI, ICON_URI, IDENTITY_NAME, chain, null, null, null, null);
        return await(f, "authorize");
    }

    // ---------------------------------------------------------------- one MWA session

    private interface WalletWork {
        JSONObject run(Session s, MobileWalletAdapterClient client, boolean legacy) throws Exception;
    }

    private JSONObject withWallet(WalletWork work) throws Exception {
        if (!walletInstalled()) return put(fail("no wallet installed"), "noWallet", true);
        if (!awaitForeground()) return fail("the app is not in front, so the wallet cannot open");

        final Session s = new Session();
        final Intent intent = LocalAssociationIntentCreator.createAssociationIntent(
                null, s.scenario.getPort(), s.scenario.getSession());
        session = s;
        try {
            if (!launch(s, intent)) return put(fail("no wallet installed"), "noWallet", true);

            final MobileWalletAdapterClient client;
            try {
                client = s.scenario.start().get(CONNECT_WAIT_MS, TimeUnit.MILLISECONDS);
            } catch (ExecutionException | TimeoutException | CancellationException e) {
                if (s.abandoned) return cancelled("the wallet closed before it connected");
                return put(fail("could not reach the wallet"), "timeout", true);
            }
            s.connected = true;
            final MobileWalletAdapterSession mwa = s.scenario.getSession();
            final SessionProperties props = mwa != null ? mwa.getSessionProperties() : null;
            final boolean legacy = props != null && props.protocolVersion == SessionProperties.ProtocolVersion.LEGACY;
            try {
                return work.run(s, client, legacy);
            } catch (Exception e) {
                final JSONObject r = s.abandoned ? cancelled("the wallet closed without an answer") : describe(e);
                // The wallet held the transactions and went quiet: they may still have reached the network.
                final boolean noAnswer = s.abandoned || e instanceof IOException
                        || (e instanceof WalletCallFailed && !(e.getCause() instanceof JsonRpc20RemoteException));
                if (s.signRequested && noAnswer) put(r, "maybeSubmitted", true);
                return r;
            }
        } finally {
            s.done = true;
            session = null;
            try {
                s.scenario.close().get(CLOSE_WAIT_MS, TimeUnit.MILLISECONDS);
            } catch (Exception ignored) {
                // closing is best effort; the wallet also times out on its own
            }
        }
    }

    /** Opens the wallet with the association intent (UI thread), so the wallet knows who is calling. */
    private boolean launch(Session s, Intent intent) throws Exception {
        final FutureTask<Boolean> task = new FutureTask<>(() -> {
            try {
                activity.startActivityForResult(intent, REQUEST_WALLET);
                s.launched = true;
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            }
        });
        ui.post(task);
        return task.get(LAUNCH_WAIT_MS, TimeUnit.MILLISECONDS);
    }

    private boolean awaitForeground() throws InterruptedException {
        final long end = SystemClock.uptimeMillis() + FOREGROUND_WAIT_MS;
        synchronized (lifecycle) {
            while (!resumed && !destroyed) {
                final long left = end - SystemClock.uptimeMillis();
                if (left <= 0) break;
                lifecycle.wait(left);
            }
            return resumed && !destroyed;
        }
    }

    private boolean isResumed() {
        synchronized (lifecycle) { return resumed && !destroyed; }
    }

    // ---------------------------------------------------------------- answers

    /** A wallet request that did not succeed, and which request it was. */
    private static final class WalletCallFailed extends Exception {
        final String stage;
        WalletCallFailed(String stage, Throwable cause) { super(stage, cause); this.stage = stage; }
    }

    private static <T> T await(Future<T> f, String stage) throws WalletCallFailed, InterruptedException {
        try {
            return f.get(REQUEST_BACKSTOP_MS, TimeUnit.MILLISECONDS);
        } catch (ExecutionException e) {
            throw new WalletCallFailed(stage, e.getCause() != null ? e.getCause() : e);
        } catch (TimeoutException | CancellationException e) {
            throw new WalletCallFailed(stage, e);
        }
    }

    private static int remoteCode(WalletCallFailed e) {
        return e.getCause() instanceof JsonRpc20RemoteException ? ((JsonRpc20RemoteException) e.getCause()).code : 0;
    }

    private static JSONObject describe(Throwable t) {
        if (t instanceof WalletCallFailed) {
            final WalletCallFailed w = (WalletCallFailed) t;
            final Throwable c = w.getCause();
            if (c instanceof JsonRpc20RemoteException) {
                final int code = ((JsonRpc20RemoteException) c).code;
                switch (code) {
                    case ProtocolContract.ERROR_AUTHORIZATION_FAILED:
                        return "authorize".equals(w.stage) ? cancelled("declined in the wallet")
                                : fail("the wallet no longer accepts this app: connect again");
                    case ProtocolContract.ERROR_NOT_SIGNED:
                        return cancelled("declined in the wallet");
                    case ProtocolContract.ERROR_NOT_SUBMITTED: {
                        final JSONArray sigs = new JSONArray();
                        if (c instanceof NotSubmittedException) {
                            for (byte[] sig : ((NotSubmittedException) c).signatures) {
                                sigs.put(sig != null ? Base58.encode(sig) : JSONObject.NULL);
                            }
                        }
                        return put(fail("the wallet signed but the network did not accept the transaction"), "signatures", sigs);
                    }
                    case ProtocolContract.ERROR_INVALID_PAYLOADS:
                        return fail("the wallet says the transaction is invalid");
                    case ProtocolContract.ERROR_TOO_MANY_PAYLOADS:
                        return fail("too many transactions for this wallet");
                    case ProtocolContract.ERROR_CLUSTER_NOT_SUPPORTED:
                        return put(fail("the wallet does not support this network"), "unsupportedChain", true);
                    default:
                        return fail("wallet error " + code + ": " + c.getMessage());
                }
            }
            if (c instanceof TimeoutException) return put(fail("timed out waiting for the wallet"), "timeout", true);
            if (c instanceof CancellationException) return cancelled("the wallet closed without an answer");
            return fail("wallet error: " + c);
        }
        if (t instanceof IOException) return cancelled("the wallet disconnected");
        Log.w(TAG, "wallet: unexpected failure", t);
        return fail("unexpected: " + t);
    }

    private void deliver(String id, JSONObject result) {
        final String js = "window.__walletResult&&window.__walletResult(" + jsId(id) + ","
                + JSONObject.quote(result.toString()) + ")";
        ui.post(() -> {
            synchronized (lifecycle) {
                if (destroyed) return;
                if (!resumed) { undelivered.add(js); return; }
            }
            web.evaluateJavascript(js, null);
        });
    }

    /** A JS number arrives here as "7" (or "7.0"), so it goes back as the number 7; other ids go back as strings. */
    private static String jsId(String id) {
        if (id == null) return "null";
        // no leading zeros: "007" must not become a legacy octal literal
        if (id.matches("-?(0|[1-9]\\d{0,14})")) return id;
        if (id.matches("-?(0|[1-9]\\d{0,14})\\.0")) return id.substring(0, id.length() - 2);
        return JSONObject.quote(id);
    }

    // ---------------------------------------------------------------- helpers

    private static boolean validChain(String chain) {
        return DEVNET.equals(chain) || MAINNET.equals(chain);
    }

    /** txsJson = JSON array of base64 serialized transactions; null when it is not. */
    private static byte[][] transactions(String txsJson) {
        try {
            final JSONArray a = new JSONArray(txsJson == null ? "" : txsJson);
            if (a.length() == 0) return null;
            final byte[][] txs = new byte[a.length()][];
            for (int i = 0; i < a.length(); i++) {
                txs[i] = Base64.decode(a.getString(i), Base64.DEFAULT);
                if (txs[i].length == 0) return null;
            }
            return txs;
        } catch (JSONException | IllegalArgumentException e) {
            return null;
        }
    }

    private static boolean authorizes(AuthorizationResult auth, String base58) {
        for (AuthorizationResult.AuthorizedAccount a : auth.accounts) {
            if (base58.equals(Base58.encode(a.publicKey))) return true;
        }
        return false;
    }

    private Intent walletProbe() {
        // Same shape as the association URI, without a session: does any app handle solana-wallet: ?
        return new Intent(Intent.ACTION_VIEW).addCategory(Intent.CATEGORY_BROWSABLE)
                .setData(Uri.parse("solana-wallet:/v1/associate/local?association=&port=0"));
    }

    private boolean walletInstalled() {
        return activity.getPackageManager().resolveActivity(walletProbe(), PackageManager.MATCH_DEFAULT_ONLY) != null;
    }

    /** The account's label from the wallet, else the wallet app's name when only one wallet is installed. */
    private String walletLabel(AuthorizationResult auth) {
        final String label = auth.accounts[0].accountLabel;
        if (label != null && !label.isEmpty()) return label;
        final PackageManager pm = activity.getPackageManager();
        final List<ResolveInfo> wallets = pm.queryIntentActivities(walletProbe(), PackageManager.MATCH_DEFAULT_ONLY);
        return wallets.size() == 1 ? String.valueOf(wallets.get(0).loadLabel(pm)) : "";
    }

    private static JSONObject json(Object... kv) {
        final JSONObject o = new JSONObject();
        for (int i = 0; i + 1 < kv.length; i += 2) put(o, (String) kv[i], kv[i + 1]);
        return o;
    }

    private static JSONObject put(JSONObject o, String key, Object value) {
        try {
            o.put(key, value);
        } catch (JSONException e) {
            throw new IllegalArgumentException(e);
        }
        return o;
    }

    private static JSONObject fail(String error) { return json("ok", false, "error", error, "cancelled", false); }

    private static JSONObject cancelled(String error) { return json("ok", false, "error", error, "cancelled", true); }

    /** For logcat: never the auth token; keys and signatures shortened. */
    private static String summary(JSONObject r) {
        if (r.optBoolean("ok")) {
            if (r.has("publicKey")) return "ok " + shorten(r.optString("publicKey"));
            final JSONArray sigs = r.optJSONArray("signatures");
            return "ok " + (sigs != null ? sigs.length() + " signature(s), first " + shorten(sigs.optString(0)) : "");
        }
        return (r.optBoolean("cancelled") ? "cancelled: " : "failed: ") + r.optString("error");
    }

    private static String shorten(String s) {
        return s.length() > 12 ? s.substring(0, 6) + "…" + s.substring(s.length() - 6) : s;
    }
}
