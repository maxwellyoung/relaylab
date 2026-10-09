using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using RelayLab.Coordinator.Models;
using RelayLab.Coordinator.Services;

namespace RelayLab.Coordinator.Controllers;

[ApiController, Route("api/experiments")]
public sealed class ExperimentsController(ExperimentService service) : ControllerBase
{
    internal static long Id(string value) => Regex.IsMatch(value, "^[1-9][0-9]{0,14}$") ? long.Parse(value) : 0;
    [HttpGet] public IActionResult List() => Ok(service.List());
    [HttpPost] public IActionResult Create([FromBody] JsonElement input) => StatusCode(201, service.Create(input));
    [HttpGet("{id}")] public IActionResult Get(string id) => Ok(service.Get(Id(id)));
    [HttpDelete("{id}")] public IActionResult Delete(string id) { service.Delete(Id(id)); return NoContent(); }
    [HttpPost("{id}/runs")]
    public async Task<IActionResult> Run(string id)
    {
        var key = Request.Headers["Idempotency-Key"].ToString().Trim();
        if (key.Length is < 1 or > 80 || !Regex.IsMatch(key, @"^[A-Za-z0-9_.:-]+$")) key = null;
        var result = await service.Execute(Id(id), key, Request.Headers["X-Request-Id"].ToString());
        Response.Headers["X-Correlation-Id"] = result.CorrelationId;
        if (result.Replay) Response.Headers["X-Idempotent-Replay"] = "true";
        return StatusCode(result.Replay ? 200 : 201, result.Run);
    }
    [HttpGet("/api/runs/{id}/execution")]
    public async Task<IActionResult> Execution(string id) { Response.Headers.CacheControl = "no-store"; return Ok(await service.Execution(Id(id))); }
}
