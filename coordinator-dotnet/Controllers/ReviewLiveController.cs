using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RelayLab.Coordinator.Models;
using RelayLab.Coordinator.Services;

namespace RelayLab.Coordinator.Controllers;

[ApiController]
public sealed class ReviewLiveController(ReviewService reviews, ReviewUpdates updates) : ControllerBase
{
    [HttpGet("api/reviews/live")]
    public async Task Connect()
    {
        if (!HttpContext.WebSockets.IsWebSocketRequest)
        {
            Response.StatusCode = 426;
            await Response.WriteAsJsonAsync(new { error = "WebSocket connection required; HTTP Refresh remains available" });
            return;
        }
        var origin = Request.Headers.Origin.ToString();
        if (origin.Length > 0 && origin != $"{Request.Scheme}://{Request.Host}"
            && origin != "http://localhost:5173" && origin != "http://127.0.0.1:5173")
            throw new ApiFailure(403, "Live update origin is not allowed");

        using var socket = await HttpContext.WebSockets.AcceptWebSocketAsync();
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(HttpContext.RequestAborted);
        Task<WebSocketReceiveResult>? incoming = null;
        try
        {
            // First-frame authentication keeps credentials out of URLs and logs.
            // No subscriber is registered and no event is sent before validation.
            var buffer = new byte[512];
            using var handshake = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            handshake.CancelAfter(TimeSpan.FromSeconds(5));
            var first = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), handshake.Token);
            if (first.MessageType != WebSocketMessageType.Text || !first.EndOfMessage)
                throw new ApiFailure(401, "Choose a demo account again");
            using var document = JsonDocument.Parse(buffer.AsMemory(0, first.Count));
            var body = document.RootElement;
            if (body.ValueKind != JsonValueKind.Object || body.EnumerateObject().Any(p => p.Name is not "type" and not "token")
                || !body.TryGetProperty("type", out var type) || type.GetString() != "subscribe"
                || !body.TryGetProperty("token", out var token) || token.ValueKind != JsonValueKind.String)
                throw new ApiFailure(401, "Choose a demo account again");
            var authorization = "Bearer " + token.GetString();
            var actor = reviews.ActorFor(authorization);
            using var subscription = updates.Subscribe(actor, authorization);
            await Send(socket, "ready", lifetime.Token);
            incoming = socket.ReceiveAsync(new ArraySegment<byte>(new byte[1]), lifetime.Token);
            var change = subscription.Changes.Reader.WaitToReadAsync(lifetime.Token).AsTask();
            using var heartbeat = new PeriodicTimer(TimeSpan.FromSeconds(15));
            var tick = heartbeat.WaitForNextTickAsync(lifetime.Token).AsTask();
            while (socket.State == WebSocketState.Open)
            {
                var next = await Task.WhenAny(incoming, change, tick);
                if (next == incoming)
                {
                    var message = await incoming;
                    incoming = null;
                    if (message.MessageType == WebSocketMessageType.Close)
                        await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Reconnect to subscribe again", lifetime.Token);
                    else
                        await Close(socket, WebSocketCloseStatus.PolicyViolation, "Reconnect to subscribe again", null);
                    break;
                }
                _ = reviews.ActorFor(authorization); // expiry/revocation applies to every outbound frame
                if (next == change)
                {
                    if (!await change) break;
                    while (subscription.Changes.Reader.TryRead(out _)) { }
                    await Send(socket, "reviews-changed", lifetime.Token);
                    change = subscription.Changes.Reader.WaitToReadAsync(lifetime.Token).AsTask();
                }
                else
                {
                    if (!await tick) break;
                    await Send(socket, "heartbeat", lifetime.Token);
                    tick = heartbeat.WaitForNextTickAsync(lifetime.Token).AsTask();
                }
            }
        }
        catch (Exception error) when (error is ApiFailure or JsonException or InvalidOperationException)
        {
            if (socket.State == WebSocketState.Open)
                await Close(socket, error is ApiFailure { Status: 429 } ? (WebSocketCloseStatus)1013 : WebSocketCloseStatus.PolicyViolation,
                    "Choose a demo account again or use Refresh", incoming);
        }
        catch (Exception error) when (error is OperationCanceledException or WebSocketException) { }
        finally { lifetime.Cancel(); }
    }
    // Returning right after CloseOutputAsync lets Kestrel reset the connection,
    // which can discard the close frame so the client sees 1006 instead of the
    // policy code. Wait briefly for the client's close reply first.
    private static async Task Close(WebSocket socket, WebSocketCloseStatus status, string reason, Task<WebSocketReceiveResult>? pending)
    {
        await socket.CloseOutputAsync(status, reason, CancellationToken.None);
        using var wait = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            var receive = pending ?? socket.ReceiveAsync(new ArraySegment<byte>(new byte[64]), wait.Token);
            while ((await receive.WaitAsync(wait.Token)).MessageType != WebSocketMessageType.Close)
                receive = socket.ReceiveAsync(new ArraySegment<byte>(new byte[64]), wait.Token);
        }
        catch (Exception error) when (error is OperationCanceledException or WebSocketException) { }
    }
    private static Task Send(WebSocket socket, string type, CancellationToken cancellation) =>
        socket.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes("{\"type\":\"" + type + "\"}")), WebSocketMessageType.Text, true, cancellation);
}
