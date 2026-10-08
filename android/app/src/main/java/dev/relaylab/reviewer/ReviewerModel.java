package dev.relaylab.reviewer;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Retained across rotation; only the current activity receives callbacks. */
final class ReviewerModel {
    final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    final Context context;
    Runnable changed;
    String origin, draft = "", validation = "", message = "Connect to load the review queue.";
    List<Review> reviews = new ArrayList<>();
    long selected = -1;
    int page;
    boolean connected, busy, saving, decisionNeedsRefresh, showEvidence;
    private int generation;
    ReviewerModel(Context context) {
        this.context = context.getApplicationContext();
        origin = ReviewNotifications.preferences(context).getString("origin", "http://10.0.2.2:3118");
        connected = ReviewNotifications.preferences(context).contains("origin");
    }
    void notifyChanged() { if (changed != null) changed.run(); }
    Review selection() {
        for (Review review : reviews) if (review.id == selected) return review;
        return null;
    }
    void connect(String value) {
        String next = Endpoint.normalize(value);
        if (!next.equals(origin)) {
            ReviewNotifications.enable(context, false);
            reviews = new ArrayList<>(); selected = -1; draft = "";
        }
        generation++; origin = next; connected = true;
        ReviewNotifications.preferences(context).edit().putString("origin", origin).apply();
        busy = false; saving = false; refresh();
    }
    void disconnect() {
        generation++; connected = false; busy = false; saving = false;
        ReviewNotifications.enable(context, false);
        ReviewNotifications.preferences(context).edit().remove("origin").apply();
        reviews = new ArrayList<>(); selected = -1; draft = "";
        message = "Disconnected. Choose a local demo API to reconnect."; notifyChanged();
    }
    void refresh() {
        if (!connected || busy) return;
        int job = generation; String endpoint = origin;
        long notificationEpoch = ReviewNotifications.preferences(context).getLong("notificationEpoch", 0);
        busy = true; message = "Loading reviews…"; notifyChanged();
        executor.execute(() -> {
            try (ApiClient api = new ApiClient(endpoint)) {
                List<Review> result = api.reviews();
                ReviewNotifications.observe(context, endpoint, notificationEpoch, result);
                main.post(() -> {
                    if (job != generation) return;
                    reviews = result; busy = false; decisionNeedsRefresh = false; message = "Queue updated just now."; notifyChanged();
                });
            } catch (Exception error) { fail(job, error, false); }
        });
    }
    void decide(String status) {
        Review review = selection();
        String feedback = draft.trim();
        if (!connected || busy || decisionNeedsRefresh || review == null || !review.status.equals("pending")) return;
        if (feedback.isEmpty() || feedback.length() > 2000) {
            validation = "Enter feedback (1–2000 characters) before deciding."; message = validation; notifyChanged(); return;
        }
        int job = generation; String endpoint = origin;
        validation = ""; busy = true; saving = true; message = "Saving decision…"; notifyChanged();
        executor.execute(() -> {
            try (ApiClient api = new ApiClient(endpoint)) {
                Review updated = api.decide(review.id, status, feedback);
                main.post(() -> {
                    if (job != generation) return;
                    for (int i = 0; i < reviews.size(); i++) if (reviews.get(i).id == updated.id) reviews.set(i, updated);
                    draft = ""; busy = false; saving = false; message = "Decision saved. The researcher can now see your feedback."; notifyChanged();
                });
            } catch (Exception error) { fail(job, error, true); }
        });
    }
    private void fail(int job, Exception error, boolean decision) {
        main.post(() -> {
            if (job != generation) return;
            busy = false; saving = false; decisionNeedsRefresh = true;
            message = error instanceof ApiClient.Failure ? error.getMessage()
                    : (decision ? "Could not confirm the decision. Refresh before retrying; your feedback is kept." : "Could not reach the API. Showing the last retrieved queue; tap Refresh to retry.");
            notifyChanged();
            // On a known conflict the server is authoritative; fetch the winning decision.
            if (decision && error instanceof ApiClient.Failure && ((ApiClient.Failure) error).status == 409) refresh();
        });
    }
    void close() { generation++; changed = null; executor.shutdown(); }
}
