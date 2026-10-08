package dev.relaylab.reviewer;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** A bounded demo session per job also recovers after coordinator restarts. */
final class ApiClient implements AutoCloseable {
    static final class Failure extends Exception {
        final int status;
        Failure(int status, String message) { super(message); this.status = status; }
    }
    private final String origin;
    private String token;
    ApiClient(String origin) { this.origin = Endpoint.normalize(origin); }
    private String request(String path, String method, JSONObject body, String bearer) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(origin + path).openConnection();
        connection.setConnectTimeout(4000);
        connection.setReadTimeout(5000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
        try {
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream stream = connection.getOutputStream()) { stream.write(bytes); }
            }
            int code = connection.getResponseCode();
            InputStream incoming = code < 400 ? connection.getInputStream() : connection.getErrorStream();
            String content = "";
            if (incoming != null) {
                try (InputStream stream = incoming; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int read;
                    while ((read = stream.read(buffer)) != -1) {
                        if (bytes.size() + read > 2_000_000) throw new IOException("Review response is too large");
                        bytes.write(buffer, 0, read);
                    }
                    content = bytes.toString(StandardCharsets.UTF_8.name());
                }
            }
            if (code < 200 || code >= 300) {
                String message = "API returned " + code;
                try { message = new JSONObject(content).optString("error", message); } catch (Exception ignored) { }
                throw new Failure(code, message);
            }
            return content;
        } finally { connection.disconnect(); }
    }
    private String session() throws Exception {
        if (token == null) token = new JSONObject(request("/api/demo-sessions", "POST", new JSONObject().put("actorId", "reviewer"), null)).getString("token");
        return token;
    }
    List<Review> reviews() throws Exception {
        JSONArray array = new JSONArray(request("/api/reviews", "GET", null, session()));
        List<Review> result = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) result.add(new Review(array.getJSONObject(i)));
        return result;
    }
    Review decide(long id, String status, String feedback) throws Exception {
        return new Review(new JSONObject(request("/api/reviews/" + id, "PATCH", new JSONObject().put("status", status).put("feedback", feedback.trim()), session())));
    }
    @Override public void close() {
        if (token != null) {
            try { request("/api/demo-sessions/current", "DELETE", null, token); } catch (Exception ignored) { /* Tokens also expire server-side. */ }
            token = null;
        }
    }
}
