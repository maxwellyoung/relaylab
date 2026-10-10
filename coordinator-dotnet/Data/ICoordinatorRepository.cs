using System.Text.Json;
using System.Text.Json.Nodes;
using RelayLab.Coordinator.Models;

namespace RelayLab.Coordinator.Data;

// Persistence adapters share this boundary so backend changes preserve the
// experiment/review services and the web/Android HTTP contract. Implementations
// must support concurrent calls and access only coordinator-owned data.
public interface ICoordinatorRepository
{
    Experiment CreateExperiment(string name, string behavior, JsonElement payload);
    IReadOnlyList<Experiment> ListExperiments();
    ExperimentDetails? GetExperiment(long id);
    bool DeleteExperiment(long id);

    Run? GetRun(long id);
    Run? FindRunByKey(long experimentId, string key);
    Run CreateRun(long experimentId, string outcome, int? rpcError, string? key, int duration, JsonNode? response);

    // A run may be submitted once. Submitted evidence must survive deletion.
    Review CreateReview(long runId, string researcherId);
    IReadOnlyList<Review> ListReviews(string? researcherId);
    Review? GetReview(long id);
    // Atomically decide only a pending review; null means another decision won.
    Review? DecideReview(long id, string status, string feedback, string reviewerId);
}
