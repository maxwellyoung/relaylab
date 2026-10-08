package dev.relaylab.reviewer;

import org.json.JSONException;
import org.json.JSONObject;

final class Review {
    final long id;
    final String name, status, researcher, submittedAt, feedback, evidence;
    final long runId;
    final String outcome, transport, transportStatus;
    final long durationMs;
    Review(JSONObject json) throws JSONException {
        id = json.getLong("id");
        runId = json.getLong("runId");
        name = json.getString("experimentName");
        status = json.getString("status");
        researcher = json.getString("researcherId");
        submittedAt = json.getString("submittedAt");
        feedback = json.isNull("feedback") ? "" : json.getString("feedback");
        JSONObject run = json.getJSONObject("run");
        outcome = run.getString("outcome");
        durationMs = run.getLong("durationMs");
        JSONObject response = run.optJSONObject("response");
        boolean grpc = response != null && "grpc".equals(response.optString("transport"));
        transport = grpc ? "gRPC" : "HTTP";
        Object signal = grpc ? response.opt("grpcStatus") : run.opt("httpStatus");
        transportStatus = signal instanceof Number ? signal.toString() : grpc ? "unknown" : "—";
        if (id <= 0 || runId <= 0 || run.getLong("id") != runId || !(status.equals("pending") || status.equals("approved") || status.equals("rejected"))) {
            throw new JSONException("Invalid review identity or status");
        }
        evidence = run.toString(2);
    }
}
