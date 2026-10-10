using Microsoft.EntityFrameworkCore;

namespace RelayLab.Coordinator.Data;

public sealed class ExperimentRow
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string Behavior { get; set; } = "";
    public string PayloadJson { get; set; } = "";
    public string CreatedAt { get; set; } = null!;
}

public sealed class RunRow
{
    public long Id { get; set; }
    public long ExperimentId { get; set; }
    public string Outcome { get; set; } = "";
    public int? HttpStatus { get; set; }
    public int? RpcErrorCode { get; set; }
    public string? IdempotencyKey { get; set; }
    public int DurationMs { get; set; }
    public string? ResponseJson { get; set; }
    public string CreatedAt { get; set; } = null!;
}

public sealed class ReviewRow
{
    public long Id { get; set; }
    public long RunId { get; set; }
    public string ResearcherId { get; set; } = "";
    public string Status { get; set; } = "pending";
    public string? Feedback { get; set; }
    public string? ReviewerId { get; set; }
    public string SubmittedAt { get; set; } = null!;
    public string? DecidedAt { get; set; }
}

public sealed class CoordinatorDbContext(DbContextOptions<CoordinatorDbContext> options) : DbContext(options)
{
    public DbSet<ExperimentRow> Experiments => Set<ExperimentRow>();
    public DbSet<RunRow> Runs => Set<RunRow>();
    public DbSet<ReviewRow> Reviews => Set<ReviewRow>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        var experiment = model.Entity<ExperimentRow>();
        experiment.ToTable("experiments");
        experiment.HasKey(row => row.Id);
        experiment.Property(row => row.Id).HasColumnName("id");
        experiment.Property(row => row.Name).HasColumnName("name");
        experiment.Property(row => row.Behavior).HasColumnName("behavior");
        experiment.Property(row => row.PayloadJson).HasColumnName("payload_json");
        experiment.Property(row => row.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("CURRENT_TIMESTAMP");

        var run = model.Entity<RunRow>();
        run.ToTable("experiment_runs");
        run.HasKey(row => row.Id);
        run.Property(row => row.Id).HasColumnName("id");
        run.Property(row => row.ExperimentId).HasColumnName("experiment_id");
        run.Property(row => row.Outcome).HasColumnName("outcome");
        run.Property(row => row.HttpStatus).HasColumnName("http_status");
        run.Property(row => row.RpcErrorCode).HasColumnName("rpc_error_code");
        run.Property(row => row.IdempotencyKey).HasColumnName("idempotency_key");
        run.Property(row => row.DurationMs).HasColumnName("duration_ms");
        run.Property(row => row.ResponseJson).HasColumnName("response_json");
        run.Property(row => row.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
        run.HasOne<ExperimentRow>().WithMany().HasForeignKey(row => row.ExperimentId).OnDelete(DeleteBehavior.Cascade);

        var review = model.Entity<ReviewRow>();
        review.ToTable("run_reviews");
        review.HasKey(row => row.Id);
        review.Property(row => row.Id).HasColumnName("id");
        review.Property(row => row.RunId).HasColumnName("run_id");
        review.Property(row => row.ResearcherId).HasColumnName("researcher_id");
        review.Property(row => row.Status).HasColumnName("status").HasDefaultValue("pending");
        review.Property(row => row.Feedback).HasColumnName("feedback");
        review.Property(row => row.ReviewerId).HasColumnName("reviewer_id");
        review.Property(row => row.SubmittedAt).HasColumnName("submitted_at").HasDefaultValueSql("CURRENT_TIMESTAMP");
        review.Property(row => row.DecidedAt).HasColumnName("decided_at");
        review.HasIndex(row => row.RunId).IsUnique();
        review.HasOne<RunRow>().WithMany().HasForeignKey(row => row.RunId).OnDelete(DeleteBehavior.Restrict);
    }
}
