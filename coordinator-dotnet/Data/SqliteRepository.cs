using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using RelayLab.Coordinator.Models;

namespace RelayLab.Coordinator.Data;

// SQL stays behind this boundary. Reusing the existing schema preserves receipts
// across coordinator implementations; the runner database is never opened here.
public sealed class SqliteRepository : ICoordinatorRepository, IDisposable
{
    private readonly SqliteConnection connection;
    private readonly object gate = new();
    public SqliteRepository()
    {
        var directory = Environment.GetEnvironmentVariable("RELAYLAB_DATA_DIR") ?? Path.Combine("data", "group", "coordinator");
        Directory.CreateDirectory(directory);
        connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(directory, "relaylab.sqlite"), ForeignKeys = true, DefaultTimeout = 5 }.ToString());
        connection.Open();
        Execute("PRAGMA journal_mode=WAL");
        var columns = Query("SELECT name FROM pragma_table_info('experiment_runs')", r => r.GetString(0));
        if (columns.Count > 0)
            foreach (var (name, type) in new[] { ("rpc_error_code", "INTEGER"), ("idempotency_key", "TEXT") })
                if (!columns.Contains(name)) Execute($"ALTER TABLE experiment_runs ADD COLUMN {name} {type}");
        Execute(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "schema.sqlite.sql")));
    }
    private SqliteCommand Command(string sql, params object?[] values)
    {
        var command = connection.CreateCommand(); command.CommandText = sql;
        for (var i = 0; i < values.Length; i++) command.Parameters.AddWithValue("$" + i, values[i] ?? DBNull.Value);
        return command;
    }
    private int Execute(string sql, params object?[] values)
    {
        using var command = Command(sql, values); return command.ExecuteNonQuery();
    }
    private List<T> Query<T>(string sql, Func<SqliteDataReader, T> map, params object?[] values)
    {
        using var command = Command(sql, values); using var reader = command.ExecuteReader();
        var rows = new List<T>(); while (reader.Read()) rows.Add(map(reader)); return rows;
    }
    private static string? Text(SqliteDataReader r, string column) => r[column] is DBNull ? null : (string)r[column];
    private static int? Number(SqliteDataReader r, string column) => r[column] is DBNull ? null : Convert.ToInt32(r[column]);
    private static string Stamp(string value) => value.Contains('T') ? value : DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
    private static Experiment MapExperiment(SqliteDataReader r) => new((long)r["id"], (string)r["name"], (string)r["behavior"], JsonSerializer.Deserialize<JsonElement>((string)r["payload_json"]), Stamp((string)r["created_at"]));
    private static Run MapRun(SqliteDataReader r) => new((long)r["id"], (long)r["experiment_id"], (string)r["outcome"], Number(r, "http_status"), Number(r, "rpc_error_code"), Text(r, "idempotency_key"), Convert.ToInt32(r["duration_ms"]), Text(r, "response_json") is { } json ? JsonNode.Parse(json) : null, Stamp((string)r["created_at"]));
    public Experiment CreateExperiment(string name, string behavior, JsonElement payload)
    {
        lock (gate) return Query("INSERT INTO experiments(name,behavior,payload_json) VALUES($0,$1,$2) RETURNING *", MapExperiment, name, behavior, payload.GetRawText()).Single();
    }
    public IReadOnlyList<Experiment> ListExperiments() { lock (gate) return Query("SELECT * FROM experiments ORDER BY id DESC", MapExperiment); }
    public ExperimentDetails? GetExperiment(long id)
    {
        lock (gate)
        {
            var item = Query("SELECT * FROM experiments WHERE id=$0", MapExperiment, id).SingleOrDefault();
            return item is null ? null : new(item.Id, item.Name, item.Behavior, item.Payload, item.CreatedAt, Query("SELECT * FROM experiment_runs WHERE experiment_id=$0 ORDER BY id DESC", MapRun, id));
        }
    }
    public bool DeleteExperiment(long id) { lock (gate) return Execute("DELETE FROM experiments WHERE id=$0", id) > 0; }
    public Run? GetRun(long id) { lock (gate) return Query("SELECT * FROM experiment_runs WHERE id=$0", MapRun, id).SingleOrDefault(); }
    public Run? FindRunByKey(long id, string key) { lock (gate) return Query("SELECT * FROM experiment_runs WHERE experiment_id=$0 AND idempotency_key=$1 ORDER BY id DESC LIMIT 1", MapRun, id, key).SingleOrDefault(); }
    public Run CreateRun(long id, string outcome, int? rpcError, string? key, int duration, JsonNode? response)
    {
        lock (gate) return Query("INSERT INTO experiment_runs(experiment_id,outcome,http_status,rpc_error_code,idempotency_key,duration_ms,response_json) VALUES($0,$1,NULL,$2,$3,$4,$5) RETURNING *", MapRun, id, outcome, rpcError, key, duration, response?.ToJsonString()).Single();
    }
    private const string ReviewQuery = "SELECT r.*,v.id AS review_id,v.researcher_id,v.status,v.feedback,v.reviewer_id,v.submitted_at,v.decided_at,e.name AS experiment_name FROM run_reviews v JOIN experiment_runs r ON r.id=v.run_id JOIN experiments e ON e.id=r.experiment_id";
    private static Review MapReview(SqliteDataReader r) => new((long)r["review_id"], (long)r["id"], (string)r["researcher_id"], (string)r["status"], Text(r,"feedback"), Text(r,"reviewer_id"), Stamp((string)r["submitted_at"]), Text(r,"decided_at") is { } stamp ? Stamp(stamp) : null, (string)r["experiment_name"], MapRun(r));
    public Review CreateReview(long runId, string actor)
    {
        lock (gate)
        {
            using var transaction = connection.BeginTransaction();
            Execute("INSERT INTO run_reviews(run_id,researcher_id) VALUES($0,$1)", runId, actor);
            var row = Query(ReviewQuery + " WHERE v.id=last_insert_rowid()", MapReview).Single();
            transaction.Commit(); return row;
        }
    }
    public IReadOnlyList<Review> ListReviews(string? researcher)
    {
        lock (gate) return Query(ReviewQuery + (researcher is null ? "" : " WHERE v.researcher_id=$0") + " ORDER BY CASE WHEN v.status='pending' THEN 0 ELSE 1 END,v.id DESC", MapReview, researcher is null ? [] : [researcher]);
    }
    public Review? GetReview(long id) { lock (gate) return Query(ReviewQuery + " WHERE v.id=$0", MapReview, id).SingleOrDefault(); }
    public Review? DecideReview(long id, string status, string feedback, string actor)
    {
        lock (gate)
        {
            using var transaction = connection.BeginTransaction();
            if (Execute("UPDATE run_reviews SET status=$0,feedback=$1,reviewer_id=$2,decided_at=CURRENT_TIMESTAMP WHERE id=$3 AND status='pending'", status, feedback, actor, id) == 0) return null;
            var row = GetReview(id); transaction.Commit(); return row;
        }
    }
    public void Dispose() { lock (gate) connection.Dispose(); }
}
