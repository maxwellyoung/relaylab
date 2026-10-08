package dev.relaylab.reviewer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Debug-only shell trigger for deterministic background integration proof. */
public final class DebugPollReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if ("dev.relaylab.reviewer.CHECK_REVIEWS".equals(intent.getAction())
                && ReviewNotifications.preferences(context).getBoolean("notifications", false)) {
            ReviewNotifications.checkNow(context);
        }
    }
}
