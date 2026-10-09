using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RelayLab.Coordinator.Models;
using RelayLab.Coordinator.Services;

namespace RelayLab.Coordinator.Controllers;

[ApiController]
public sealed class ReviewsController(ReviewService service) : ControllerBase
{
    private string Authorization => Request.Headers.Authorization.ToString();
    private Actor Actor() { Response.Headers.CacheControl = "no-store"; return service.ActorFor(Authorization); }
    [HttpPost("api/demo-sessions")]
    public IActionResult Session([FromBody] JsonElement input) { Response.Headers.CacheControl = "no-store"; return StatusCode(201, service.CreateSession(input)); }
    [HttpDelete("api/demo-sessions/current")]
    public IActionResult Revoke() { Response.Headers.CacheControl = "no-store"; service.Revoke(Authorization); return NoContent(); }
    [HttpGet("api/reviews")]
    public IActionResult List() => Ok(service.List(Actor()));
    [HttpGet("api/reviews/{id}")]
    public IActionResult Get(string id) => Ok(service.Get(Actor(), ExperimentsController.Id(id)));
    [HttpPost("api/runs/{id}/reviews")]
    public IActionResult Submit(string id)
    {
        var review = service.Submit(Actor(), ExperimentsController.Id(id));
        return Created("/api/reviews/" + review.Id, review);
    }
    [HttpPatch("api/reviews/{id}")]
    public IActionResult Decide(string id, [FromBody] JsonElement input) => Ok(service.Decide(Actor(), ExperimentsController.Id(id), input));
}
