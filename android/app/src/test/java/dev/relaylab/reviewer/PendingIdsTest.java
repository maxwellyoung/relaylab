package dev.relaylab.reviewer;
import org.junit.Test;
import java.util.Set;
import static org.junit.Assert.*;
public class PendingIdsTest {
    @Test public void firstSnapshotEstablishesBaselineWithoutAlerting() {
        assertTrue(PendingIds.newIds(null, Set.of("1", "2")).isEmpty());
    }
    @Test public void alertsOnlyOnNewPendingIds() {
        assertEquals(Set.of("3"), PendingIds.newIds(Set.of("1", "2"), Set.of("2", "3")));
        assertTrue(PendingIds.newIds(Set.of("1", "2", "3"), Set.of("2", "3")).isEmpty());
        assertTrue(PendingIds.newIds(Set.of("1"), Set.of()).isEmpty());
    }
    @Test public void aLateOlderSnapshotCannotCauseDuplicateAlerts() {
        Set<String> known = PendingIds.remember(Set.of("1"), Set.of("1", "2"));
        known = PendingIds.remember(known, Set.of("1"));
        assertTrue(PendingIds.newIds(known, Set.of("1", "2")).isEmpty());
    }
}
