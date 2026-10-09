using System.Text.Json;
using System.Text.Json.Nodes;

namespace RelayLab.Coordinator.Models;

public record Experiment(long Id, string Name, string Behavior, JsonElement Payload, string CreatedAt);
public record ExperimentDetails(long Id, string Name, string Behavior, JsonElement Payload, string CreatedAt, IReadOnlyList<Run> Runs)
    : Experiment(Id, Name, Behavior, Payload, CreatedAt);
public record Run(long Id, long ExperimentId, string Outcome, int? HttpStatus, int? RpcErrorCode, string? IdempotencyKey, int DurationMs, JsonNode? Response, string CreatedAt);
public record Review(long Id, long RunId, string ResearcherId, string Status, string? Feedback, string? ReviewerId, string SubmittedAt, string? DecidedAt, string ExperimentName, Run Run);
public record Actor(string Id, string Name, string Role);

public sealed class ApiFailure(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
