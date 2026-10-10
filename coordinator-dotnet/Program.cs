using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.FileProviders;
using RelayLab.Coordinator.Data;
using RelayLab.Coordinator.Models;
using RelayLab.Coordinator.Services;

var builder = WebApplication.CreateBuilder(args);
var port = Environment.GetEnvironmentVariable("PORT") ?? "3000";
builder.WebHost.UseUrls("http://127.0.0.1:" + port);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 100 * 1024);
builder.Services.AddSingleton<ICoordinatorRepository, SqliteRepository>();
builder.Services.AddSingleton<RunnerGateway>();
builder.Services.AddSingleton<ExperimentService>();
builder.Services.AddSingleton<ReviewService>();
builder.Services.AddControllers().ConfigureApiBehaviorOptions(options =>
{
    options.SuppressMapClientErrors = true;
    options.InvalidModelStateResponseFactory = _ => new BadRequestObjectResult(new { error = "Invalid JSON body" });
});
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.WithOrigins("http://localhost:5173", "http://127.0.0.1:5173").AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("X-Correlation-Id", "X-Idempotent-Replay")));
var app = builder.Build();
_ = app.Services.GetRequiredService<ICoordinatorRepository>();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api")) context.Response.Headers.CacheControl = "no-store";
    try { await next(context); }
    catch (Exception error) when (!context.Response.HasStarted)
    {
        var (status, message) = error switch
        {
            ApiFailure failure => (failure.Status, failure.Message),
            BadHttpRequestException failure => (failure.StatusCode, "Request rejected"),
            SqliteException { SqliteExtendedErrorCode: 2067 or 1555 } => (409, "This run has already been submitted for review"),
            SqliteException { SqliteExtendedErrorCode: 787 or 1811 } => (409, "Submitted run evidence must be preserved. Refresh to see current state."),
            _ => (503, "Persistence temporarily unavailable")
        };
        if (status >= 500) app.Logger.LogWarning("Coordinator request failed: {Type}", error.GetType().Name);
        context.Response.Clear(); context.Response.StatusCode = status;
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(new { error = message });
    }
});
app.UseStatusCodePages(async context => await context.HttpContext.Response.WriteAsJsonAsync(new { error = "Request rejected" }));
app.UseCors();
var clientDirectory = Environment.GetEnvironmentVariable("CLIENT_DIST_DIR");
if (clientDirectory is not null && Directory.Exists(clientDirectory)) app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(Path.GetFullPath(clientDirectory)) });
app.MapControllers();
app.MapGet("/health", (RunnerGateway runner) => new { status = "ok", service = "relaylab-coordinator", database = "sqlite", downstreamTimeoutMs = runner.TimeoutMs, executionTransport = "grpc", implementation = "dotnet" });
app.MapFallback(async context =>
{
    if (context.Request.Method == "GET" && !context.Request.Path.StartsWithSegments("/api") && clientDirectory is not null && File.Exists(Path.Combine(clientDirectory, "index.html")))
        await context.Response.SendFileAsync(Path.Combine(clientDirectory, "index.html"));
    else { context.Response.StatusCode = 404; await context.Response.WriteAsJsonAsync(new { error = "Not found" }); }
});
app.Lifetime.ApplicationStarted.Register(() => Console.WriteLine("relaylab-coordinator-ready:" + port));
app.Run();
