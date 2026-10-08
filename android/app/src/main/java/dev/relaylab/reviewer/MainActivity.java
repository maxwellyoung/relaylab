package dev.relaylab.reviewer;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.text.InputFilter;
import android.text.TextWatcher;
import android.text.Editable;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int INK = Color.rgb(32, 46, 38), GREEN = Color.rgb(23, 77, 55), PAPER = Color.rgb(245, 243, 236);
    private ReviewerModel model;
    private LinearLayout column;
    private TextView state, validation;
    private EditText feedback;
    private Button refresh, approve, reject;
    private final Handler handler = new Handler();
    private boolean resumed;
    private String screenSignature = "";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            if (model.connected) model.refresh();
            handler.postDelayed(this, 10000);
        }
    };
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        Object retained = getLastNonConfigurationInstance();
        model = retained instanceof ReviewerModel ? (ReviewerModel) retained : new ReviewerModel(this);
        if (saved != null && retained == null) {
            model.selected = saved.getLong("selected", -1); model.draft = saved.getString("draft", "");
        }
        ReviewNotifications.channel(this);
        model.changed = this::render;
        if (saved == null) model.selected = getIntent().getLongExtra("reviewId", model.selected);
        render();
    }
    @Override public Object onRetainNonConfigurationInstance() { model.changed = null; return model; }
    @Override protected void onSaveInstanceState(Bundle out) {
        out.putLong("selected", model.selected); out.putString("draft", model.draft); super.onSaveInstanceState(out);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        model.selected = intent.getLongExtra("reviewId", -1); model.draft = ""; screenSignature = ""; render(); model.refresh();
    }
    @Override protected void onResume() {
        super.onResume(); resumed = true; screenSignature = ""; render();
        handler.removeCallbacks(poll); poll.run();
    }
    @Override protected void onPause() { resumed = false; handler.removeCallbacks(poll); super.onPause(); }
    @Override protected void onDestroy() {
        handler.removeCallbacks(poll); model.changed = null;
        if (!isChangingConfigurations()) model.close();
        super.onDestroy();
    }
    @Override public void onBackPressed() {
        if (model.selected > 0) { model.selected = -1; model.draft = ""; screenSignature = ""; render(); }
        else super.onBackPressed();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(INK);
        view.setPadding(0, dp(6), 0, dp(6));
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        column.addView(view); return view;
    }
    private Button button(String title, boolean primary, Runnable action) {
        Button button = new Button(this); button.setText(title); button.setAllCaps(false); button.setTextSize(16);
        button.setTextColor(primary ? Color.WHITE : GREEN);
        GradientDrawable shape = new GradientDrawable(); shape.setColor(primary ? GREEN : Color.WHITE); shape.setCornerRadius(dp(12));
        shape.setStroke(dp(1), primary ? GREEN : Color.rgb(208, 215, 205)); button.setBackground(shape);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(6), 0, dp(6));
        button.setMinHeight(dp(52)); column.addView(button, params); button.setOnClickListener(v -> action.run()); return button;
    }
    private String signature() {
        StringBuilder value = new StringBuilder(model.connected + ":" + model.selected + ":" + model.origin + ":" + model.showEvidence);
        for (Review review : model.reviews) value.append('/').append(review.id).append(':').append(review.status).append(':').append(review.feedback);
        value.append('/').append(ReviewNotifications.preferences(this).getBoolean("permissionDenied", false));
        value.append('/').append(ReviewNotifications.preferences(this).getBoolean("notifications", false)).append('/').append(ReviewNotifications.permitted(this));
        return value.toString();
    }
    private void render() {
        if (isFinishing() || isDestroyed()) return;
        String next = signature();
        if (next.equals(screenSignature) && state != null) { updateState(); return; }
        screenSignature = next;
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(PAPER);
        column = new LinearLayout(this); column.setOrientation(LinearLayout.VERTICAL); column.setPadding(dp(24), dp(24), dp(24), dp(32));
        scroll.addView(column); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets;
        });
        scroll.requestApplyInsets();
        text("RELAYLAB / REVIEWER", 12, true).setTextColor(GREEN);
        text(model.selected > 0 ? "Run review" : "Review queue", 32, true);
        text("Local demo · Reviewer identity", 14, false);
        state = text(model.message, 14, false); state.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        refresh = approve = reject = null; feedback = null; validation = null;
        if (!model.connected) { connectionForm(); return; }
        refresh = button("Refresh queue", false, model::refresh);
        Review selected = model.selection();
        if (model.selected > 0) {
            button("Back to queue", false, () -> { model.selected = -1; model.draft = ""; screenSignature = ""; render(); });
            if (selected == null) text(model.busy ? "Loading selected review…" : "This review is absent from the last retrieved queue. Refresh or return to the queue.", 16, false);
            else detail(selected);
        } else {
            long count = model.reviews.stream().filter(r -> r.status.equals("pending")).count();
            text(count + " waiting for feedback", 20, true);
            if (model.reviews.isEmpty()) text("No reviews retrieved. A researcher can submit a run from the web lab.", 16, false);
            for (Review review : model.reviews) {
                Button row = button(review.name + "\nRun #" + review.runId + " · " + review.status.toUpperCase(Locale.ROOT) + " · " + review.outcome, false,
                        () -> { model.selected = review.id; model.draft = ""; model.validation = ""; model.showEvidence = false; screenSignature = ""; render(); });
                row.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL); row.setPadding(dp(16), dp(12), dp(16), dp(12));
            }
            notificationSettings();
            text("API: " + model.origin + "\nDemo account selection is open; this is not password sign-in.", 12, false);
            button("Disconnect / change API", false, model::disconnect);
        }
        updateState();
    }
    private void connectionForm() {
        text("Connect to the coordinator", 20, true);
        text("The emulator reaches your computer through 10.0.2.2. Start the group server before connecting.", 16, false);
        EditText origin = new EditText(this); origin.setText(model.origin); origin.setSingleLine(true); origin.setTextSize(16);
        origin.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        origin.setContentDescription("Coordinator API origin"); column.addView(origin);
        button("Connect as demo reviewer", true, () -> {
            try { model.connect(origin.getText().toString()); } catch (IllegalArgumentException error) { model.message = error.getMessage(); state.setText(model.message); }
        });
    }
    private void detail(Review review) {
        text(review.name, 24, true);
        text("Review #" + review.id + " · Run #" + review.runId + "\n" + review.researcher + " · " + review.submittedAt, 14, false);
        text(review.status.toUpperCase(Locale.ROOT) + " · Execution: " + review.outcome, 16, true);
        text("Recorded duration: " + review.durationMs + " ms", 14, false);
        button(model.showEvidence ? "Hide execution evidence" : "Inspect execution evidence", false, () -> { model.showEvidence = !model.showEvidence; render(); });
        if (model.showEvidence) {
            TextView evidence = text(review.evidence, 12, false); evidence.setTypeface(Typeface.MONOSPACE); evidence.setTextIsSelectable(true);
        }
        if (review.status.equals("pending")) {
            text("Your feedback", 18, true);
            feedback = new EditText(this); feedback.setTextSize(16); feedback.setMinLines(3); feedback.setGravity(android.view.Gravity.TOP);
            feedback.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            feedback.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2000)}); feedback.setHint("What did the evidence show?");
            feedback.setContentDescription("Review feedback"); feedback.setText(model.draft); column.addView(feedback);
            feedback.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
                public void onTextChanged(CharSequence s, int start, int before, int count) { model.draft = s.toString(); if (!model.draft.trim().isEmpty()) { model.validation = ""; updateState(); } }
                public void afterTextChanged(Editable s) { }
            });
            validation = text(model.validation, 14, false); validation.setTextColor(Color.rgb(150, 39, 39));
            validation.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            approve = button("Approve run", true, () -> model.decide("approved"));
            reject = button("Reject run", false, () -> model.decide("rejected"));
            text("A decision preserves the run outcome and cannot be edited. Feedback is required.", 12, false);
        } else {
            text("Reviewer feedback", 18, true); text(review.feedback, 16, false);
        }
    }
    private void updateState() {
        state.setText(model.message);
        if (validation != null) { validation.setText(model.validation); validation.setVisibility(model.validation.isEmpty() ? View.GONE : View.VISIBLE); }
        if (refresh != null) refresh.setEnabled(!model.busy);
        if (approve != null) approve.setEnabled(!model.busy && !model.decisionNeedsRefresh);
        if (reject != null) reject.setEnabled(!model.busy && !model.decisionNeedsRefresh);
        if (feedback != null) feedback.setEnabled(!model.busy);
    }
    private void notificationSettings() {
        boolean enabled = ReviewNotifications.preferences(this).getBoolean("notifications", false);
        text("New run notifications", 20, true);
        if (ReviewNotifications.preferences(this).getBoolean("permissionDenied", false) && !ReviewNotifications.permitted(this))
            text("Notification permission denied. The review queue remains available.", 14, false);
        text(enabled ? (ReviewNotifications.permitted(this)
                ? "Enabled. Checks run every 10 seconds while open and periodically in the background (15 minutes or longer)."
                : "Android is blocking these alerts. Allow notifications in system settings or disable them here.")
                : "Optional alerts for new submissions. Reviews still work when notification permission is denied.", 14, false);
        if (enabled && !ReviewNotifications.permitted(this)) button("Open notification settings", false, () ->
                startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())));
        button(enabled ? "Disable notifications" : "Enable notifications", false, () -> {
            if (enabled) { ReviewNotifications.enable(this, false); screenSignature = ""; render(); }
            else if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10);
            else enableNotifications();
        });
        if (enabled) button("Check notifications now", false, () -> { ReviewNotifications.checkNow(this); model.refresh(); });
    }
    private void enableNotifications() {
        if (!ReviewNotifications.permitted(this)) { model.message = "Notifications are blocked in Android settings. You can still review runs here."; updateState(); return; }
        ReviewNotifications.preferences(this).edit().remove("permissionDenied").apply();
        ReviewNotifications.enable(this, true); model.refresh(); screenSignature = ""; render();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 10 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) enableNotifications();
        else if (requestCode == 10) {
            ReviewNotifications.preferences(this).edit().putBoolean("permissionDenied", true).apply();
            model.message = "Notification permission denied. The review queue remains available."; render();
        }
    }
}
