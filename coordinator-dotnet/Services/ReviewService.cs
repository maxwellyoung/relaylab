using System.Text.Json;
using System.Text.RegularExpressions;
using RelayLab.Coordinator.Data;
using RelayLab.Coordinator.Models;

namespace RelayLab.Coordinator.Services;

// Selectable actors are a local workflow demonstration, not password accounts.
// Tokens are bounded, expiring, revocable and never persisted or logged.
public sealed class ReviewService(SqliteRepository repository)
{
    private record Session(Actor Actor, DateTimeOffset ExpiresAt);
    private readonly Dictionary<string, Session> sessions = new();
    private readonly object gate = new();
    private static readonly Dictionary<string, Actor> actors = new()
    {
        ["researcher-a"] = new("researcher-a", "Researcher A", "researcher"),
        ["researcher-b"] = new("researcher-b", "Researcher B", "researcher"),
        ["reviewer"] = new("reviewer", "Reviewer", "reviewer")
    };
    private static bool Keys(JsonElement body, params string[] keys) => body.ValueKind == JsonValueKind.Object && body.EnumerateObject().All(property => keys.Contains(property.Name));
    public object CreateSession(JsonElement body)
    {
        if (Environment.GetEnvironmentVariable("RELAYLAB_REVIEW_DEMO") != "true") throw new ApiFailure(403, "Review demo is disabled. Start the coordinator with RELAYLAB_REVIEW_DEMO=true.");
        if (!Keys(body, "actorId") || !body.TryGetProperty("actorId", out var value) || value.ValueKind != JsonValueKind.String || !actors.TryGetValue(value.GetString()!, out var actor)) throw new ApiFailure(400, "Choose a known demo account");
        lock (gate)
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var key in sessions.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToArray()) sessions.Remove(key);
            if (sessions.Count >= 256) throw new ApiFailure(429, "Too many demo sessions; end an existing session first");
            var token = Guid.NewGuid().ToString(); sessions[token] = new(actor, now.AddHours(1)); return new { token, actor };
        }
    }
    public Actor ActorFor(string authorization)
    {
        lock (gate)
        {
            var match = Regex.Match(authorization, "^Bearer ([0-9a-f-]{36})$");
            if (match.Success && sessions.TryGetValue(match.Groups[1].Value, out var session) && session.ExpiresAt > DateTimeOffset.UtcNow) return session.Actor;
            if (match.Success) sessions.Remove(match.Groups[1].Value);
            throw new ApiFailure(401, "Choose a demo account again; the session is missing or expired");
        }
    }
    public void Revoke(string authorization) { _ = ActorFor(authorization); lock (gate) sessions.Remove(authorization[7..]); }
    public IReadOnlyList<Review> List(Actor actor) => repository.ListReviews(actor.Role == "researcher" ? actor.Id : null);
    public Review Get(Actor actor, long id)
    {
        var review = repository.GetReview(id);
        if (review is null || actor.Role == "researcher" && review.ResearcherId != actor.Id) throw new ApiFailure(404, "Review not found");
        return review;
    }
    public Review Submit(Actor actor, long id)
    {
        if (actor.Role != "researcher") throw new ApiFailure(403, "Only a researcher can submit a run");
        if (repository.GetRun(id) is null) throw new ApiFailure(404, "Run not found");
        return repository.CreateReview(id, actor.Id);
    }
    public Review Decide(Actor actor, long id, JsonElement body)
    {
        if (actor.Role != "reviewer") throw new ApiFailure(403, "Only a reviewer can decide a review");
        if (!Keys(body, "status", "feedback") || !body.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.String || status.GetString() is not "approved" and not "rejected"
            || !body.TryGetProperty("feedback", out var feedback) || feedback.ValueKind != JsonValueKind.String || feedback.GetString()!.Trim().Length is < 1 or > 2000)
            throw new ApiFailure(400, "Choose approved or rejected and provide feedback (1–2000 characters)");
        _ = Get(actor, id);
        return repository.DecideReview(id, status.GetString()!, feedback.GetString()!.Trim(), actor.Id) ?? throw new ApiFailure(409, "This run has already been reviewed. Refresh to see the decision.");
    }
}
