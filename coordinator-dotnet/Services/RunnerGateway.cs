using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Grpc.Core;
using Grpc.Net.Client;
using Relaylab.Runner.V1;
using RelayLab.Coordinator.Models;

namespace RelayLab.Coordinator.Services;

public record ExecutionView(string ExecutionId, string OperationId, string ExperimentRef, string State, string Outcome, string ResultJson, string StartedAt, string CompletedAt);
public record ExecutionResult(string Outcome, int? RpcErrorCode, JsonNode Response);
public sealed class RunnerGateway : IDisposable
{
    private GrpcChannel channel;
    private Runner.RunnerClient client;
    private readonly string address;
    private readonly object gate = new();
    private int activeCalls;
    private bool reconnectWhenIdle, closed;
    private readonly string prefix;
    public int TimeoutMs { get; }
    public RunnerGateway()
    {
        var target = Environment.GetEnvironmentVariable("RELAYLAB_RUNNER_TARGET") ?? "127.0.0.1:50051";
        prefix = Environment.GetEnvironmentVariable("RELAYLAB_RUNNER_NAMESPACE") ?? "relaylab";
        if (!Regex.IsMatch(target, @"^(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$") || int.Parse(target.Split(':')[1]) > 65535) throw new InvalidOperationException("Runner must use a loopback target");
        if (!Regex.IsMatch(prefix, @"^[A-Za-z0-9_-]{1,32}$")) throw new InvalidOperationException("Invalid runner namespace");
        TimeoutMs = int.TryParse(Environment.GetEnvironmentVariable("DOWNSTREAM_TIMEOUT_MS"), out var timeout) ? timeout : 400;
        if (TimeoutMs is < 1 or > 30000) throw new InvalidOperationException("Invalid runner deadline");
        address = "http://" + target;
        channel = GrpcChannel.ForAddress(address); client = new Runner.RunnerClient(channel);
    }
    private async Task<Execution> Call(Func<Runner.RunnerClient, Task<Execution>> invoke)
    {
        Runner.RunnerClient connection;
        lock (gate) { ObjectDisposedException.ThrowIf(closed, this); activeCalls++; connection = client; }
        try { return await invoke(connection); }
        catch (RpcException error) when (error.StatusCode == StatusCode.Unavailable)
        {
            lock (gate) reconnectWhenIdle = true;
            throw;
        }
        finally
        {
            lock (gate)
            {
                activeCalls--;
                // Retry promptly after a runner restart, without cancelling a
                // concurrent call or letting channel backoff consume its deadline.
                if (activeCalls == 0 && reconnectWhenIdle && !closed)
                {
                    channel.Dispose(); channel = GrpcChannel.ForAddress(address);
                    client = new Runner.RunnerClient(channel); reconnectWhenIdle = false;
                }
            }
        }
    }
    private static ExecutionView View(Execution e) => new(e.ExecutionId, e.OperationId, e.ExperimentRef, e.State, e.Outcome, e.ResultJson, e.StartedAt, e.CompletedAt);
    private static bool Valid(Execution e) => Guid.TryParse(e.ExecutionId, out _) && e.State is "RUNNING" or "COMPLETED" or "INTERRUPTED" && DateTimeOffset.TryParse(e.StartedAt, out _);
    public async Task<ExecutionView> Get(string operationId)
    {
        try
        {
            var execution = await Call(connection => connection.GetExecutionAsync(new GetExecutionRequest { OperationId = operationId }, deadline: DateTime.UtcNow.AddMilliseconds(TimeoutMs)).ResponseAsync);
            if (!Valid(execution) || execution.OperationId != operationId) throw new ApiFailure(503, "Runner returned an invalid execution");
            return View(execution);
        }
        catch (RpcException error) { throw new ApiFailure(error.StatusCode == StatusCode.NotFound ? 404 : 503, error.StatusCode == StatusCode.NotFound ? "Execution not found in the runner ledger; the recorded attempt may not have been accepted." : "Runner execution unavailable; check the runner and try again"); }
    }
    public async Task<ExecutionResult> Execute(Experiment experiment, string correlationId, string? key)
    {
        var operationId = $"{prefix}:{experiment.Id}:{key ?? correlationId}";
        var experimentRef = $"{prefix}:experiment:{experiment.Id}";
        Execution execution;
        try
        {
            execution = await Call(connection => connection.ExecuteRunAsync(new ExecuteRunRequest { OperationId = operationId, CorrelationId = correlationId, ExperimentRef = experimentRef, Behavior = experiment.Behavior, PayloadJson = experiment.Payload.GetRawText() }, deadline: DateTime.UtcNow.AddMilliseconds(TimeoutMs)).ResponseAsync);
        }
        catch (RpcException error)
        {
            var code = (int)error.StatusCode;
            var outcome = error.StatusCode == StatusCode.DeadlineExceeded ? "timeout" : error.StatusCode == StatusCode.Unavailable ? "unreachable" : "downstream_error";
            var message = code == 4 ? "Runner deadline exceeded; an accepted execution may still complete. Check execution status or retry with the same key." : code == 14 ? "Runner unavailable. Restore the runner, then retry or check execution status." : "Runner refused or could not persist the execution; inspect its status before starting new work.";
            return new(outcome, code, new JsonObject { ["transport"] = "grpc", ["id"] = correlationId, ["operationId"] = operationId, ["grpcStatus"] = code, ["message"] = message });
        }
        JsonNode? result;
        try { result = JsonNode.Parse(execution.ResultJson); } catch (JsonException) { result = JsonValue.Create(execution.ResultJson); }
        var validIdentity = Valid(execution) && execution.OperationId == operationId && execution.ExperimentRef == experimentRef && execution.State == "COMPLETED";
        var validSuccess = result is JsonObject obj && obj["accepted"] is JsonValue accepted && accepted.TryGetValue<bool>(out var yes) && yes
            && obj["experimentRef"]?.ToString() == experimentRef && JsonNode.DeepEquals(obj["echo"], JsonNode.Parse(experiment.Payload.GetRawText()))
            && DateTimeOffset.TryParse(obj["processedAt"]?.ToString(), out _);
        var validFailure = result is JsonObject failure && failure["error"] is JsonValue value && value.TryGetValue<string>(out _);
        var classified = !validIdentity ? "invalid_response" : execution.Outcome == "success" && validSuccess ? "success" : execution.Outcome == "downstream_error" && validFailure ? "downstream_error" : "invalid_response";
        return new(classified, null, new JsonObject { ["transport"] = "grpc", ["id"] = correlationId, ["operationId"] = operationId, ["grpcStatus"] = 0, ["execution"] = JsonSerializer.SerializeToNode(View(execution), new JsonSerializerOptions(JsonSerializerDefaults.Web)), ["result"] = result });
    }
    public void Dispose() { lock (gate) { closed = true; channel.Dispose(); } }
}
