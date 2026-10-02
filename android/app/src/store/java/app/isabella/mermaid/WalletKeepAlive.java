package app.isabella.mermaid;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * Keeps the game awake while a wallet request is open. While the wallet app is in front, Android
 * freezes our backgrounded process after about 70 s; the wallet's answer then never reaches the
 * Mobile Wallet Adapter session and a slow parent's approval is lost. A foreground service (a
 * "short service" on Android 14+) keeps the process out of the freezer until the answer arrives.
 */
public class WalletKeepAlive extends Service {
    private static final String TAG = "Isabella";
    private static final String CHANNEL = "wallet";

    static void start(Context c) {
        try {
            c.startForegroundService(new Intent(c, WalletKeepAlive.class));
        } catch (Exception e) {
            Log.w(TAG, "wallet: keep-alive not started: " + e);
        }
    }

    static void stop(Context c) {
        try { c.stopService(new Intent(c, WalletKeepAlive.class)); } catch (Exception e) { /* already gone */ }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Wallet requests", NotificationManager.IMPORTANCE_LOW));
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Isabella Ocean")
                .setContentText("Waiting for your wallet")
                .setOngoing(true)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
            else startForeground(1, n);
        } catch (Exception e) {
            Log.w(TAG, "wallet: keep-alive could not enter the foreground: " + e);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    /** A short service may run about 3 minutes; past that the request is left to the normal cancel path. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.i(TAG, "wallet: keep-alive time limit reached");
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
