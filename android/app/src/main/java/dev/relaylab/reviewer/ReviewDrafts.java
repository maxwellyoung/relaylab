package dev.relaylab.reviewer;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Set;

/** Unsent feedback, one draft per normalized API origin and review. Never holds session tokens. */
final class ReviewDrafts {
    interface Store { String get(String key); void put(String key, String value); void remove(String key); Set<String> keys(); }
    private final Store store;
    ReviewDrafts(Store store) { this.store = store; }
    static ReviewDrafts of(Context context) {
        // Private and excluded from cloud backup and device transfer by data_extraction_rules.
        SharedPreferences prefs = context.getApplicationContext().getSharedPreferences("review_drafts", Context.MODE_PRIVATE);
        return new ReviewDrafts(new Store() {
            public String get(String key) { return prefs.getString(key, null); }
            public void put(String key, String value) { prefs.edit().putString(key, value).apply(); }
            public void remove(String key) { prefs.edit().remove(key).apply(); }
            public Set<String> keys() { return prefs.getAll().keySet(); }
        });
    }
    // '|' cannot appear in a normalized origin, so a port such as :31180 never matches :3118.
    private static String prefix(String origin) { return origin + "|"; }
    private static String key(String origin, long reviewId) { return prefix(origin) + reviewId; }
    String load(String origin, long reviewId) {
        String value = reviewId > 0 ? store.get(key(origin, reviewId)) : null;
        return value == null ? "" : value;
    }
    boolean has(String origin, long reviewId) { return !load(origin, reviewId).isEmpty(); }
    void save(String origin, long reviewId, String text) {
        if (reviewId <= 0) return;
        if (text.trim().isEmpty()) store.remove(key(origin, reviewId)); else store.put(key(origin, reviewId), text);
    }
    void discard(String origin, long reviewId) { if (reviewId > 0) store.remove(key(origin, reviewId)); }
    void discardOrigin(String origin) {
        for (String key : store.keys()) if (key.startsWith(prefix(origin))) store.remove(key);
    }
}
