package dev.relaylab.reviewer;
import org.junit.Test;
import static org.junit.Assert.*;
public class EndpointTest {
    @Test public void localAndTlsOriginsAreNormalized() {
        assertEquals("http://10.0.2.2:3118", Endpoint.normalize(" http://10.0.2.2:3118/ "));
        assertEquals("https://lab.example", Endpoint.normalize("https://lab.example"));
    }
    @Test public void refusesCredentialsPathsAndRemoteCleartext() {
        for (String value : new String[]{"http://example.com", "https://user:secret@lab.example", "https://lab.example/path", "https://lab.example?token=x", "file:///tmp", "https://lab.example#x"}) {
            try { Endpoint.normalize(value); fail(value); } catch (IllegalArgumentException expected) { }
        }
    }
}
