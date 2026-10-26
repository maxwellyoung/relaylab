package dev.relaylab.reviewer;
import org.junit.Test;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import static org.junit.Assert.*;
public class ReviewDraftsTest {
    private static final String LOCAL = "http://10.0.2.2:3118", OTHER = "https://lab.example";
    /** In-memory stand-in for the private SharedPreferences file. */
    static final class MemoryStore implements ReviewDrafts.Store {
        final Map<String, String> values = new HashMap<>();
        public String get(String key) { return values.get(key); }
        public void put(String key, String value) { values.put(key, value); }
        public void remove(String key) { values.remove(key); }
        public Set<String> keys() { return Set.copyOf(values.keySet()); }
    }
    @Test public void eachReviewKeepsItsOwnDraft() {
        ReviewDrafts drafts = new ReviewDrafts(new MemoryStore());
        drafts.save(LOCAL, 1, "Timeout looks expected");
        drafts.save(LOCAL, 12, "Payload echo is missing");
        assertEquals("Timeout looks expected", drafts.load(LOCAL, 1));
        assertEquals("Payload echo is missing", drafts.load(LOCAL, 12));
        assertEquals("", drafts.load(LOCAL, 2));
    }
    @Test public void identicalReviewIdsOnDifferentServersDoNotShareText() {
        ReviewDrafts drafts = new ReviewDrafts(new MemoryStore());
        drafts.save(LOCAL, 7, "Local note");
        assertEquals("", drafts.load(OTHER, 7));
        drafts.save(OTHER, 7, "Remote note");
        assertEquals("Local note", drafts.load(LOCAL, 7));
    }
    @Test public void blankTextAndDiscardRemoveTheStoredDraft() {
        MemoryStore store = new MemoryStore(); ReviewDrafts drafts = new ReviewDrafts(store);
        drafts.save(LOCAL, 3, "Needs a rerun");
        drafts.save(LOCAL, 3, "   ");
        assertTrue(store.values.isEmpty());
        drafts.save(LOCAL, 3, "Needs a rerun");
        drafts.discard(LOCAL, 3);
        assertFalse(drafts.has(LOCAL, 3));
    }
    @Test public void whitespaceIsPreservedWhileEditing() {
        ReviewDrafts drafts = new ReviewDrafts(new MemoryStore());
        drafts.save(LOCAL, 4, "First line\n");
        assertEquals("First line\n", drafts.load(LOCAL, 4));
    }
    @Test public void discardingAnOriginLeavesOtherServersAndSimilarPortsAlone() {
        ReviewDrafts drafts = new ReviewDrafts(new MemoryStore());
        drafts.save(LOCAL, 1, "Remove me");
        drafts.save(LOCAL + "0", 1, "Similar port");
        drafts.save(OTHER, 1, "Other server");
        drafts.discardOrigin(LOCAL);
        assertFalse(drafts.has(LOCAL, 1));
        assertEquals("Similar port", drafts.load(LOCAL + "0", 1));
        assertEquals("Other server", drafts.load(OTHER, 1));
    }
    @Test public void unsavedSelectionsAreIgnored() {
        MemoryStore store = new MemoryStore(); ReviewDrafts drafts = new ReviewDrafts(store);
        drafts.save(LOCAL, -1, "No review selected");
        assertTrue(store.values.isEmpty());
        assertEquals("", drafts.load(LOCAL, -1));
    }
}
