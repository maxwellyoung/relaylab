package dev.relaylab.reviewer;

import java.net.URI;
import java.util.Locale;

final class Endpoint {
    private Endpoint() { }
    static String normalize(String value) {
        try {
            URI uri = URI.create(value.trim());
            String scheme = uri.getScheme(), host = uri.getHost();
            boolean tls = "https".equals(scheme);
            boolean local = "http".equals(scheme) && ("10.0.2.2".equals(host) || "127.0.0.1".equals(host) || "localhost".equals(host));
            if ((!tls && !local) || host == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                    || (!uri.getPath().isEmpty() && !"/".equals(uri.getPath())) || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IllegalArgumentException();
            }
            return scheme + "://" + host.toLowerCase(Locale.ROOT) + (uri.getPort() < 0 ? "" : ":" + uri.getPort());
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("Use an HTTPS origin, or a local debug origin such as http://10.0.2.2:3118");
        }
    }
}
