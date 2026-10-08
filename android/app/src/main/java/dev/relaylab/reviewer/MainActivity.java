package dev.relaylab.reviewer;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.text.Editable;
import android.text.InputFilter;
import android.text.SpannableString;
import android.text.TextWatcher;
import android.text.style.RelativeSizeSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import static dev.relaylab.reviewer.ReviewTheme.*;

public final class MainActivity extends Activity {
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
            model.selected = saved.getLong("selected", -1); model.draft = saved.getString("draft", ""); model.page = saved.getInt("page", 0);
        }
        ReviewNotifications.channel(this); model.changed = this::render;
        if (saved == null) model.selected = getIntent().getLongExtra("reviewId", model.selected);
        render();
    }
    @Override public Object onRetainNonConfigurationInstance() { model.changed = null; return model; }
    @Override protected void onSaveInstanceState(Bundle out) {
        out.putLong("selected", model.selected); out.putString("draft", model.draft); out.putInt("page", model.page); super.onSaveInstanceState(out);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        model.selected = intent.getLongExtra("reviewId", -1); model.page = 0; model.draft = ""; screenSignature = ""; render(); model.refresh();
    }
    @Override protected void onResume() {
        super.onResume(); resumed = true; screenSignature = ""; render(); handler.removeCallbacks(poll); poll.run();
    }
    @Override protected void onPause() { resumed = false; handler.removeCallbacks(poll); super.onPause(); }
    @Override protected void onDestroy() {
        handler.removeCallbacks(poll); model.changed = null; if (!isChangingConfigurations()) model.close(); super.onDestroy();
    }
    @Override public void onBackPressed() {
        if (model.selected > 0 || model.page != 0) { model.selected = -1; model.page = 0; model.draft = ""; screenSignature = ""; render(); }
        else super.onBackPressed();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void gap(int height) { View view = new View(this); column.addView(view, new LinearLayout.LayoutParams(1, dp(height))); }
    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(INK); view.setLineSpacing(dp(3), 1f);
        view.setTypeface(Typeface.create(bold ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
        column.addView(view, new LinearLayout.LayoutParams(-1, -2)); return view;
    }
    private TextView muted(String value, int size) { TextView view = text(value, size, false); view.setTextColor(MUTED); return view; }
    private GradientDrawable shape(int colour, int radius) { GradientDrawable shape = new GradientDrawable(); shape.setColor(colour); shape.setCornerRadius(dp(radius)); return shape; }
    private Button control(String title, boolean primary, Runnable action) {
        Button button = new Button(this); button.setText(title); button.setAllCaps(false); button.setTextSize(14); button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setTextColor(primary ? Color.WHITE : INK); button.setMinHeight(dp(48)); button.setMinimumWidth(0); button.setMinWidth(0); button.setPadding(dp(16), dp(8), dp(16), dp(8));
        button.setStateListAnimator(null); button.setElevation(0);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(primary ? 0x33ffffff : 0x15127183), shape(primary ? ACCENT : SURFACE, 10), null));
        button.setOnClickListener(v -> action.run()); return button;
    }
    private Button button(String title, boolean primary, Runnable action) {
        Button button = control(title, primary, action); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(6), 0, dp(6)); column.addView(button, params); return button;
    }
    private void divider() { View line = new View(this); line.setBackgroundColor(LINE); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(1)); params.setMargins(0, dp(20), 0, dp(20)); column.addView(line, params); }
    private String date(String timestamp) {
        try { return DateTimeFormatter.ofPattern("d MMM · h:mm a", Locale.getDefault()).withZone(ZoneId.systemDefault()).format(Instant.parse(timestamp)); }
        catch (RuntimeException error) { return timestamp; }
    }
    private String signature() {
        StringBuilder value = new StringBuilder(model.connected + ":" + model.page + ":" + model.selected + ":" + model.origin + ":" + model.showEvidence);
        // A new queue item must not replace the focused editor or reset its scroll.
        if (model.selected > 0) {
            Review selected = model.selection();
            if (selected != null) value.append('/').append(selected.id).append(':').append(selected.status).append(':').append(selected.feedback);
        } else if (model.page != 2) {
            for (Review review : model.reviews) value.append('/').append(review.id).append(':').append(review.status).append(':').append(review.feedback);
        }
        value.append('/').append(ReviewNotifications.preferences(this).getBoolean("permissionDenied", false));
        value.append('/').append(ReviewNotifications.preferences(this).getBoolean("notifications", false)).append('/').append(ReviewNotifications.permitted(this)); return value.toString();
    }
    private void render() {
        if (isFinishing() || isDestroyed()) return;
        String next = signature(); if (next.equals(screenSignature) && state != null) { updateState(); return; } screenSignature = next;
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(PAPER); setContentView(root);
        root.setOnApplyWindowInsetsListener((v, insets) -> { v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets; }); root.requestApplyInsets();
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        column = new LinearLayout(this); column.setOrientation(LinearLayout.VERTICAL); column.setPadding(dp(24), dp(12), dp(24), dp(28)); scroll.addView(column);
        refresh = approve = reject = null; feedback = null; validation = null;
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); column.addView(bar);
        TextView brand = new TextView(this); brand.setText("RelayLab"); brand.setTextSize(17); brand.setTextColor(INK); brand.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        RelayGlyph mark = new RelayGlyph(ACCENT, 0); mark.setBounds(0, 0, dp(24), dp(24)); brand.setCompoundDrawables(mark, null, null, null); brand.setCompoundDrawablePadding(dp(8));
        bar.addView(brand, new LinearLayout.LayoutParams(0, dp(48), 1)); brand.setGravity(Gravity.CENTER_VERTICAL);
        if (model.connected) { refresh = control("Refresh queue", false, model::refresh); refresh.setTextColor(MUTED); refresh.setBackgroundColor(Color.TRANSPARENT); refresh.setTextSize(12); bar.addView(refresh); }
        gap(22);
        if (!model.connected) { text("Connect to RelayLab", 27, true); gap(8); muted("Inspect the run. Leave useful feedback. Keep the evidence.", 15); gap(28); state = muted(model.message, 13); connectionForm(); return; }
        if (model.selected > 0) {
            Button back = button("Back to queue", false, () -> { model.selected = -1; model.page = 0; model.draft = ""; screenSignature = ""; render(); }); back.setGravity(Gravity.START | Gravity.CENTER_VERTICAL); back.setPadding(0, 0, 0, 0); back.setTextColor(ACCENT); back.setBackgroundColor(Color.TRANSPARENT);
            Review selected = model.selection(); state = muted(model.message, 12); gap(20);
            if (selected == null) text(model.busy ? "Loading selected review…" : "This review is absent from the last retrieved queue. Refresh or return to the queue.", 15, false);
            else detail(selected);
        } else {
            text(model.page == 2 ? "Settings" : model.page == 1 ? "Review history" : "Review queue", 27, true);
            gap(6); state = muted(model.message, 12); state.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); gap(24);
            if (model.page == 2) settings(); else queue(model.page == 1);
            navigation(root);
        }
        updateState();
    }
    private void navigation(LinearLayout root) {
        LinearLayout nav = new LinearLayout(this); nav.setGravity(Gravity.CENTER); nav.setPadding(dp(12), dp(8), dp(12), dp(8)); nav.setBackgroundColor(SURFACE);
        String[] labels = {"Queue", "History", "Settings"};
        for (int i = 0; i < labels.length; i++) {
            int page = i; Button item = control(labels[i], false, () -> { model.page = page; screenSignature = ""; render(); });
            item.setTextColor(model.page == page ? ACCENT : MUTED); item.setTextSize(12); item.setBackgroundColor(Color.TRANSPARENT);
            RelayGlyph glyph = new RelayGlyph(model.page == page ? ACCENT : MUTED, i + 1); glyph.setBounds(0, 0, dp(22), dp(22)); item.setCompoundDrawables(null, glyph, null, null); item.setCompoundDrawablePadding(dp(4)); item.setSelected(model.page == page);
            nav.addView(item, new LinearLayout.LayoutParams(0, dp(62), 1));
        }
        View line = new View(this); line.setBackgroundColor(LINE); root.addView(line, new LinearLayout.LayoutParams(-1, dp(1))); root.addView(nav);
    }
    private void queue(boolean history) {
        List<Review> rows = model.reviews.stream().filter(r -> history != r.status.equals("pending")).collect(Collectors.toList());
        if (history) { muted(rows.size() + " reviewed · decisions are final", 13); gap(18); }
        else { muted(rows.size() + " waiting for feedback", 14); gap(18); }
        if (rows.isEmpty()) {
            gap(24); text(history ? "No decisions yet." : "Nothing waiting.", 22, true); gap(8);
            muted(history ? "Completed reviews will stay here with their evidence and feedback." : "New submissions will appear here. You can check again with Refresh.", 15);
        }
        for (int i = 0; i < rows.size(); i++) {
            Review review = rows.get(i); boolean focus = !history && i == 0;
            if (focus) { muted("Next to review", 13); gap(10); }
            String detail = "Run #" + review.runId + " · " + review.outcome.replace('_', ' ') + " · " + review.durationMs + " ms";
            String value = review.name + "\n" + detail + "\n" + (focus ? "Open review  →" : history ? review.status + " · " + date(review.submittedAt) : date(review.submittedAt) + "  →");
            SpannableString label = new SpannableString(value); label.setSpan(new StyleSpan(Typeface.BOLD), 0, review.name.length(), 0); label.setSpan(new RelativeSizeSpan(focus ? 21f / 13f : 16f / 13f), 0, review.name.length(), 0);
            label.setSpan(new ForegroundColorSpan(MUTED), review.name.length() + 1, review.name.length() + 1 + detail.length(), 0);
            int start = value.lastIndexOf('\n') + 1; label.setSpan(new ForegroundColorSpan(focus ? ACCENT : MUTED), start, value.length(), 0);
            Button row = control("", false, () -> { model.selected = review.id; model.draft = ""; model.validation = ""; model.showEvidence = false; screenSignature = ""; render(); });
            row.setText(label); row.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL)); row.setTextSize(13); row.setLineSpacing(dp(focus ? 10 : 6), 1f); row.setGravity(Gravity.START | Gravity.CENTER_VERTICAL); row.setPadding(focus ? dp(20) : 0, dp(focus ? 24 : 18), focus ? dp(20) : 0, dp(focus ? 24 : 18));
            if (focus) row.setBackground(new RippleDrawable(ColorStateList.valueOf(0x15127183), shape(SURFACE, 18), null));
            else row.setBackground(new RippleDrawable(ColorStateList.valueOf(0x15127183), shape(Color.TRANSPARENT, 0), null));
            column.addView(row, new LinearLayout.LayoutParams(-1, -2));
            if (focus) { gap(24); if (rows.size() > 1) muted("Also waiting", 13); }
            else { View line = new View(this); line.setBackgroundColor(LINE); column.addView(line, new LinearLayout.LayoutParams(-1, dp(1))); }
        }
    }
    private void connectionForm() {
        gap(18); text("Coordinator API", 14, true); gap(8);
        EditText origin = new EditText(this); origin.setText(model.origin); origin.setSingleLine(true); origin.setTextSize(15); origin.setPadding(dp(14), dp(10), dp(14), dp(10)); origin.setBackground(shape(SURFACE, 10));
        origin.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI); origin.setContentDescription("Coordinator API origin"); column.addView(origin);
        gap(12); button("Connect as demo reviewer", true, () -> { try { model.connect(origin.getText().toString()); } catch (IllegalArgumentException error) { model.message = error.getMessage(); state.setText(model.message); } });
        gap(12); muted("Local demo identity. Anyone can choose this role.\nOn an emulator, 10.0.2.2 reaches your computer.", 12);
    }
    private void detail(Review review) {
        muted("Run #" + review.runId + " · " + date(review.submittedAt), 13); gap(8); text(review.name, 25, true); gap(8);
        muted("Submitted by " + review.researcher.replace('-', ' '), 13); gap(22);
        LinearLayout receipt = new LinearLayout(this); receipt.setPadding(dp(18), dp(18), dp(18), dp(18)); receipt.setBackground(shape(SURFACE, 14)); receipt.setGravity(Gravity.CENTER_VERTICAL); column.addView(receipt);
        TextView outcome = new TextView(this); outcome.setText("Execution\n" + review.outcome.replace('_', ' ')); outcome.setTextSize(15); outcome.setTextColor(review.outcome.equals("success") ? ACCENT : WARN); outcome.setLineSpacing(dp(6), 1f); receipt.addView(outcome, new LinearLayout.LayoutParams(0, -2, 1));
        TextView duration = new TextView(this); duration.setText(review.durationMs + " ms\nRecorded duration"); duration.setTextSize(13); duration.setTextColor(MUTED); duration.setGravity(Gravity.END); duration.setLineSpacing(dp(6), 1f); receipt.addView(duration);
        TextView protocol = new TextView(this); protocol.setText(review.transport + " " + review.transportStatus); protocol.setTextSize(12); protocol.setTextColor(MUTED); protocol.setGravity(Gravity.END);
        LinearLayout.LayoutParams protocolParams = new LinearLayout.LayoutParams(-1, -2); protocolParams.setMargins(0, dp(10), 0, 0); column.addView(protocol, protocolParams);
        gap(10); Button evidence = button(model.showEvidence ? "Hide execution evidence" : "Inspect execution evidence", false, () -> { model.showEvidence = !model.showEvidence; render(); }); evidence.setTextColor(ACCENT); evidence.setGravity(Gravity.START | Gravity.CENTER_VERTICAL); evidence.setPadding(0, 0, 0, 0); evidence.setBackgroundColor(Color.TRANSPARENT);
        if (model.showEvidence) {
            // Keep large receipts inspectable without pushing the decision far away.
            ScrollView snippet = new ScrollView(this); snippet.setNestedScrollingEnabled(true); snippet.setBackground(shape(SURFACE, 10));
            TextView body = new TextView(this); body.setText(review.evidence); body.setTextSize(12); body.setTextColor(INK); body.setTypeface(Typeface.MONOSPACE); body.setTextIsSelectable(true); body.setPadding(dp(14), dp(14), dp(14), dp(14));
            snippet.addView(body); column.addView(snippet, new LinearLayout.LayoutParams(-1, dp(220))); gap(12);
        }
        divider();
        if (review.status.equals("pending")) {
            text("Your feedback", 18, true); gap(6); muted("What does this run tell the researcher?", 13); gap(14);
            feedback = new EditText(this); feedback.setTextSize(15); feedback.setMinLines(3); feedback.setGravity(Gravity.TOP); feedback.setTextColor(INK); feedback.setPadding(dp(16), dp(14), dp(16), dp(14)); feedback.setBackground(shape(SURFACE, 12));
            feedback.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); feedback.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2000)}); feedback.setHint("Leave a useful note…"); feedback.setContentDescription("Review feedback"); feedback.setText(model.draft); column.addView(feedback);
            feedback.addTextChangedListener(new TextWatcher() { public void beforeTextChanged(CharSequence s, int start, int count, int after) { } public void afterTextChanged(Editable s) { } public void onTextChanged(CharSequence s, int start, int before, int count) { model.draft = s.toString(); if (!model.draft.trim().isEmpty()) { model.validation = ""; updateState(); } } });
            gap(8); validation = text(model.validation, 13, false); validation.setTextColor(BAD); validation.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); gap(14);
            LinearLayout actions = new LinearLayout(this); column.addView(actions);
            reject = control("Reject run", false, () -> model.decide("rejected")); approve = control("Approve run", true, () -> model.decide("approved"));
            LinearLayout.LayoutParams left = new LinearLayout.LayoutParams(0, dp(50), 1); left.setMargins(0, 0, dp(10), 0); actions.addView(reject, left); actions.addView(approve, new LinearLayout.LayoutParams(0, dp(50), 1));
            gap(12); muted("Feedback is required. Decisions are final; execution evidence stays intact.", 12);
        } else {
            TextView status = text(review.status.equals("approved") ? "Approved" : "Rejected", 18, true); status.setTextColor(review.status.equals("approved") ? ACCENT : BAD); gap(12);
            text(review.feedback, 16, false); gap(14); muted("Decision saved. The run's execution outcome is unchanged.", 12);
        }
    }
    private void updateState() {
        state.setText(model.message);
        if (validation != null) { validation.setText(model.validation); validation.setVisibility(model.validation.isEmpty() ? View.GONE : View.VISIBLE); }
        if (refresh != null) refresh.setEnabled(!model.busy);
        if (approve != null) approve.setEnabled(!model.busy && !model.decisionNeedsRefresh);
        if (reject != null) reject.setEnabled(!model.busy && !model.decisionNeedsRefresh);
        if (feedback != null) feedback.setEnabled(!model.saving);
    }
    private void settings() {
        text("Reviewer · local demo", 18, true); gap(8); muted("This is an open demo role, not password sign-in.", 13); divider();
        text("New run notifications", 18, true); gap(8); notificationSettings(); divider();
        text("Connected API", 15, true); gap(8); muted(model.origin, 14); gap(12);
        button("Disconnect / change API", false, () -> { model.page = 0; model.disconnect(); });
    }
    private void notificationSettings() {
        boolean enabled = ReviewNotifications.preferences(this).getBoolean("notifications", false);
        if (ReviewNotifications.preferences(this).getBoolean("permissionDenied", false) && !ReviewNotifications.permitted(this)) { text("Notification permission denied. The review queue remains available.", 13, false).setTextColor(BAD); gap(8); }
        muted(enabled ? (ReviewNotifications.permitted(this) ? "Enabled. Checked every 10 seconds while open, and every 15 minutes or longer in the background." : "Android is blocking these alerts. Allow them in system settings or disable them here.") : "Optional alerts when a new run arrives. You can review without notification permission.", 14); gap(12);
        if (!ReviewNotifications.permitted(this) && (enabled || ReviewNotifications.preferences(this).getBoolean("permissionDenied", false))) button("Open notification settings", false, () -> startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())));
        button(enabled ? "Disable notifications" : "Enable notifications", false, () -> { if (enabled) { ReviewNotifications.enable(this, false); screenSignature = ""; render(); } else if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10); else enableNotifications(); });
        if (enabled) button("Check notifications now", false, () -> { ReviewNotifications.checkNow(this); model.refresh(); });
    }
    private void enableNotifications() {
        if (!ReviewNotifications.permitted(this)) { model.message = "Notifications are blocked in Android settings. You can still review runs here."; updateState(); return; }
        ReviewNotifications.preferences(this).edit().remove("permissionDenied").apply(); ReviewNotifications.enable(this, true); model.refresh(); screenSignature = ""; render();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 10 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) enableNotifications();
        else if (requestCode == 10) { ReviewNotifications.preferences(this).edit().putBoolean("permissionDenied", true).apply(); model.message = "Notification permission denied. The review queue remains available."; render(); }
    }
}
