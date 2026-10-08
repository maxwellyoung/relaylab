package dev.relaylab.reviewer;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class ReviewPollWorker extends Worker {
    public ReviewPollWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }
    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = ReviewNotifications.preferences(context);
        if (!prefs.getBoolean("notifications", false) || !ReviewNotifications.permitted(context)) return Result.success();
        String origin = prefs.getString("origin", "");
        long epoch = prefs.getLong("notificationEpoch", 0);
        if (origin.isEmpty()) return Result.success();
        try (ApiClient api = new ApiClient(origin)) {
            ReviewNotifications.observe(context, origin, epoch, api.reviews());
            return Result.success();
        } catch (ApiClient.Failure failure) {
            // Retry transient failures only; disabled demos need the user's attention.
            return failure.status >= 500 || failure.status == 429 ? Result.retry() : Result.failure();
        } catch (Exception error) { return Result.retry(); }
    }
}
