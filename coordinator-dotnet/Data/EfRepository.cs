using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using RelayLab.Coordinator.Models;

namespace RelayLab.Coordinator.Data;

public sealed class EfRepository : ICoordinatorRepository
{
    private readonly IDbContextFactory<CoordinatorDbContext> factory;

    public EfRepository(IDbContextFactory<CoordinatorDbContext> factory)
    {
        this.factory = factory;
        using var database = factory.CreateDbContext();
        database.Database.OpenConnection();
        CoordinatorDatabase.Initialize((SqliteConnection)database.Database.GetDbConnection());
    }

    private static string Stamp(string value) => value.Contains('T') ? value : DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
    private static Experiment Map(ExperimentRow row) => new(row.Id, row.Name, row.Behavior, JsonSerializer.Deserialize<JsonElement>(row.PayloadJson), Stamp(row.CreatedAt));

    private static Run Map(RunRow row) => new(row.Id, row.ExperimentId, row.Outcome, row.HttpStatus, row.RpcErrorCode, row.IdempotencyKey, row.DurationMs, row.ResponseJson is { } json ? JsonNode.Parse(json) : null, Stamp(row.CreatedAt));

    private T Write<T>(Func<CoordinatorDbContext, T> action)
    {
        using var database = factory.CreateDbContext();
        try { return action(database); }
        catch (DbUpdateException error) when (error.InnerException is SqliteException { SqliteExtendedErrorCode: 2067 or 1555 })
        { throw new ApiFailure(409, "This run has already been submitted for review"); }
        catch (DbUpdateException error) when (error.InnerException is SqliteException { SqliteExtendedErrorCode: 787 or 1811 })
        { throw new ApiFailure(409, "Submitted run evidence must be preserved. Refresh to see current state."); }
        catch (SqliteException error) when (error.SqliteExtendedErrorCode is 2067 or 1555)
        { throw new ApiFailure(409, "This run has already been submitted for review"); }
        catch (SqliteException error) when (error.SqliteExtendedErrorCode is 787 or 1811)
        { throw new ApiFailure(409, "Submitted run evidence must be preserved. Refresh to see current state."); }
    }

    public Experiment CreateExperiment(string name, string behavior, JsonElement payload)
    {
        using var database = factory.CreateDbContext();
        var row = new ExperimentRow { Name = name, Behavior = behavior, PayloadJson = payload.GetRawText() };
        database.Experiments.Add(row);
        database.SaveChanges();
        return Map(row);
    }
    public IReadOnlyList<Experiment> ListExperiments()
    {
        using var database = factory.CreateDbContext();
        return database.Experiments.AsNoTracking().OrderByDescending(row => row.Id).ToList().Select(Map).ToList();
    }
    public ExperimentDetails? GetExperiment(long id)
    {
        using var database = factory.CreateDbContext();
        var row = database.Experiments.AsNoTracking().SingleOrDefault(row => row.Id == id);
        var item = row is null ? null : Map(row);
        return item is null ? null : new(item.Id, item.Name, item.Behavior, item.Payload, item.CreatedAt, database.Runs.AsNoTracking().Where(row => row.ExperimentId == id).OrderByDescending(row => row.Id).ToList().Select(Map).ToList());
    }
    public bool DeleteExperiment(long id) => Write(database => database.Experiments.Where(row => row.Id == id).ExecuteDelete() > 0);

    public Run? GetRun(long id)
    {
        using var database = factory.CreateDbContext();
        var row = database.Runs.AsNoTracking().SingleOrDefault(row => row.Id == id);
        return row is null ? null : Map(row);
    }
    public Run? FindRunByKey(long experimentId, string key)
    {
        using var database = factory.CreateDbContext();
        var row = database.Runs.AsNoTracking().Where(row => row.ExperimentId == experimentId && row.IdempotencyKey == key).OrderByDescending(row => row.Id).FirstOrDefault();
        return row is null ? null : Map(row);
    }
    public Run CreateRun(long experimentId, string outcome, int? rpcError, string? key, int duration, JsonNode? response) => Write(database =>
    {
        var row = new RunRow { ExperimentId = experimentId, Outcome = outcome, RpcErrorCode = rpcError, IdempotencyKey = key, DurationMs = duration, ResponseJson = response?.ToJsonString() };
        database.Runs.Add(row);
        database.SaveChanges();
        return Map(row);
    });
    private sealed class ReviewData
    {
        public ReviewRow Review { get; init; } = null!;
        public RunRow Run { get; init; } = null!;
        public string ExperimentName { get; init; } = "";
    }
    private static IQueryable<ReviewData> ReviewQuery(CoordinatorDbContext database) =>
        from review in database.Reviews.AsNoTracking()
        join run in database.Runs.AsNoTracking() on review.RunId equals run.Id
        join experiment in database.Experiments.AsNoTracking() on run.ExperimentId equals experiment.Id
        select new ReviewData { Review = review, Run = run, ExperimentName = experiment.Name };
    private static Review Map(ReviewData data)
    {
        var row = data.Review;
        return new(row.Id, row.RunId, row.ResearcherId, row.Status, row.Feedback, row.ReviewerId, Stamp(row.SubmittedAt), row.DecidedAt is { } stamp ? Stamp(stamp) : null, data.ExperimentName, Map(data.Run));
    }
    private static Review? ReadReview(CoordinatorDbContext database, long id)
    {
        var row = ReviewQuery(database).SingleOrDefault(row => row.Review.Id == id);
        return row is null ? null : Map(row);
    }

    public Review CreateReview(long runId, string researcherId) => Write(database =>
    {
        using var transaction = database.Database.BeginTransaction();
        var row = new ReviewRow { RunId = runId, ResearcherId = researcherId };
        database.Reviews.Add(row);
        database.SaveChanges();
        var result = ReadReview(database, row.Id) ?? throw new InvalidOperationException("Created review not found");
        transaction.Commit();
        return result;
    });
    public IReadOnlyList<Review> ListReviews(string? researcherId)
    {
        using var database = factory.CreateDbContext();
        var query = ReviewQuery(database);
        if (researcherId is not null) query = query.Where(row => row.Review.ResearcherId == researcherId);
        return query.OrderBy(row => row.Review.Status == "pending" ? 0 : 1).ThenByDescending(row => row.Review.Id).ToList().Select(Map).ToList();
    }
    public Review? GetReview(long id)
    {
        using var database = factory.CreateDbContext();
        return ReadReview(database, id);
    }
    public Review? DecideReview(long id, string status, string feedback, string reviewerId) => Write<Review?>(database =>
    {
        using var transaction = database.Database.BeginTransaction();
        var decidedAt = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        // A database-side condition chooses one winner even across processes.
        // Reading the resulting receipt shares this transaction and context.
        var changed = database.Reviews.Where(row => row.Id == id && row.Status == "pending")
            .ExecuteUpdate(setters => setters.SetProperty(row => row.Status, status)
                .SetProperty(row => row.Feedback, feedback)
                .SetProperty(row => row.ReviewerId, reviewerId)
                .SetProperty(row => row.DecidedAt, decidedAt));
        if (changed == 0) return null;
        var result = ReadReview(database, id) ?? throw new InvalidOperationException("Decided review not found");
        transaction.Commit();
        return result;
    });
}
