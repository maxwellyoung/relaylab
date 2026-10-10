using Microsoft.Data.Sqlite;

namespace RelayLab.Coordinator.Data;

// Both adapters apply the canonical schema. EF startup must not recreate a
// database or rebuild tables that already hold experiment/review evidence.
public static class CoordinatorDatabase
{
    public static string ConnectionString()
    {
        var directory = Environment.GetEnvironmentVariable("RELAYLAB_DATA_DIR") ?? Path.Combine("data", "group", "coordinator");
        Directory.CreateDirectory(directory);
        return new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(directory, "relaylab.sqlite"),
            ForeignKeys = true,
            DefaultTimeout = 5
        }.ToString();
    }

    public static void Initialize(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode=WAL";
        command.ExecuteNonQuery();
        command.CommandText = "SELECT name FROM pragma_table_info('experiment_runs')";
        var columns = new HashSet<string>();
        using (var reader = command.ExecuteReader())
            while (reader.Read()) columns.Add(reader.GetString(0));
        if (columns.Count > 0)
            foreach (var (name, type) in new[] { ("rpc_error_code", "INTEGER"), ("idempotency_key", "TEXT") })
                if (!columns.Contains(name))
                {
                    command.CommandText = $"ALTER TABLE experiment_runs ADD COLUMN {name} {type}";
                    command.ExecuteNonQuery();
                }
        command.CommandText = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "schema.sqlite.sql"));
        command.ExecuteNonQuery();
    }
}
