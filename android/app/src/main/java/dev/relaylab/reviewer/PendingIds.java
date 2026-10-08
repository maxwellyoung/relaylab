package dev.relaylab.reviewer;

import java.util.HashSet;
import java.util.Set;

final class PendingIds {
    private PendingIds() { }
    static Set<String> newIds(Set<String> previouslySeen, Set<String> pending) {
        Set<String> arrivals = new HashSet<>(pending);
        if (previouslySeen == null) arrivals.clear();
        else arrivals.removeAll(previouslySeen);
        return arrivals;
    }
    static Set<String> remember(Set<String> previouslySeen, Set<String> observed) {
        Set<String> known = new HashSet<>(observed);
        if (previouslySeen != null) known.addAll(previouslySeen);
        return known;
    }
}
