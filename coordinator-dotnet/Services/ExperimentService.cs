using System.Text.Json;
using System.Diagnostics;
using RelayLab.Coordinator.Data;
using RelayLab.Coordinator.Models;

namespace RelayLab.Coordinator.Services;

public sealed class ExperimentService(ICoordinatorRepository repository, RunnerGateway runner)
{
    public Experiment Create(JsonElement input)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(name.GetString()) || name.GetString()!.Trim().Length > 80
            || !input.TryGetProperty("behavior", out var behavior) || behavior.ValueKind != JsonValueKind.String || !new[] { "healthy", "slow", "unavailable", "malformed" }.Contains(behavior.GetString())
            || !input.TryGetProperty("payload", out var payload) || payload.ValueKind != JsonValueKind.Object)
            throw new ApiFailure(400, "Invalid experiment");
        return repository.CreateExperiment(name.GetString()!.Trim(), behavior.GetString()!, payload);
    }
    public IReadOnlyList<Experiment> List() => repository.ListExperiments();
    public ExperimentDetails Get(long id) => repository.GetExperiment(id) ?? throw new ApiFailure(404, "Experiment not found");
    public void Delete(long id) { if (!repository.DeleteExperiment(id)) throw new ApiFailure(404, "Experiment not found"); }
    public async Task<(Run Run, bool Replay, string CorrelationId)> Execute(long id, string? key, string? requestedId)
    {
        var item = Get(id);
        var previous = key is null ? null : repository.FindRunByKey(id, key);
        if (previous is not null && previous.Outcome is not "timeout" and not "unreachable")
            return (previous, true, previous.Response?["id"]?.ToString() ?? "");
        var correlationId = Guid.TryParseExact(requestedId, "D", out var guid) ? guid.ToString() : Guid.NewGuid().ToString();
        var timer = Stopwatch.StartNew();
        var result = await runner.Execute(item, correlationId, key);
        var run = repository.CreateRun(id, result.Outcome, result.RpcErrorCode, key, Math.Max(1, (int)timer.ElapsedMilliseconds), result.Response);
        return (run, false, correlationId);
    }
    public async Task<ExecutionView> Execution(long id)
    {
        var run = repository.GetRun(id) ?? throw new ApiFailure(404, "Run not found");
        if (run.Response is not System.Text.Json.Nodes.JsonObject response || response["transport"]?.ToString() != "grpc" || response["operationId"] is null) throw new ApiFailure(409, "This run has no configured gRPC execution");
        return await runner.Get(response["operationId"]!.ToString());
    }
}
