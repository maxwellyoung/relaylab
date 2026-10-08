package dev.relaylab.reviewer;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

final class ReviewNotifications {
    static final String CHANNEL = "new_reviews";
    static final String PERIODIC = "relaylab-review-poll";
    static final String ONCE = "relaylab-review-check";
    private static final Object LOCK = new Object();
    private ReviewNotifications() { }
    static SharedPreferences preferences(Context context) { return context.getSharedPreferences("reviewer", Context.MODE_PRIVATE); }
    static boolean permitted(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                && context.getSystemService(NotificationManager.class).areNotificationsEnabled()
                && (context.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL) == null
                    || context.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL).getImportance() != NotificationManager.IMPORTANCE_NONE);
    }
    static void channel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "New review submissions", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("A new run is waiting for a reviewer. Background checks are periodic.");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static void enable(Context context, boolean enabled) {
        synchronized (LOCK) {
            // A new opt-in starts from a fresh successful snapshot, avoiding backlog alerts.
            SharedPreferences prefs = preferences(context);
            prefs.edit().putBoolean("notifications", enabled).remove("seen")
                    .putLong("notificationEpoch", prefs.getLong("notificationEpoch", 0) + 1).apply();
            WorkManager manager = WorkManager.getInstance(context);
            if (enabled) {
                PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(ReviewPollWorker.class, 15, TimeUnit.MINUTES)
                        .setInitialDelay(15, TimeUnit.MINUTES)
                        .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
                manager.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request);
                checkNow(context);
            } else {
                manager.cancelUniqueWork(PERIODIC);
                manager.cancelUniqueWork(ONCE);
                context.getSystemService(NotificationManager.class).cancelAll();
            }
        }
    }
    static void checkNow(Context context) {
        WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP,
                new OneTimeWorkRequest.Builder(ReviewPollWorker.class).setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build());
    }
    static void observe(Context context, String origin, long epoch, List<Review> reviews) {
        synchronized (LOCK) {
            SharedPreferences prefs = preferences(context);
            // A response from a disconnected origin or disabled job must not post later.
            if (epoch != prefs.getLong("notificationEpoch", 0) || !prefs.getBoolean("notifications", false) || !origin.equals(prefs.getString("origin", "")) || !permitted(context)) return;
            Set<String> pending = new HashSet<>(), observed = new HashSet<>();
            for (Review review : reviews) {
                String id = Long.toString(review.id);
                observed.add(id);
                if (review.status.equals("pending")) pending.add(id);
            }
            Set<String> known = prefs.contains("seen") ? prefs.getStringSet("seen", null) : null;
            for (String id : PendingIds.newIds(known, pending)) {
                Intent intent = new Intent(context, MainActivity.class).setData(android.net.Uri.parse("relaylab://review/" + id)).putExtra("reviewId", Long.parseLong(id))
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                PendingIntent tap = PendingIntent.getActivity(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification notification = new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_review)
                        .setContentTitle("New run ready for review").setContentText("Open RelayLab to inspect the evidence and give feedback.")
                        .setContentIntent(tap).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build();
                context.getSystemService(NotificationManager.class).notify("review-" + id, 0, notification);
            }
            // Foreground and worker responses can arrive out of order. Never forget
            // a seen ID, or a late older snapshot could trigger a duplicate alert.
            prefs.edit().putStringSet("seen", PendingIds.remember(known, observed)).apply();
        }
    }
}
