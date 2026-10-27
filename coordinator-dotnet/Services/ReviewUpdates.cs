using System.Threading.Channels;
using RelayLab.Coordinator.Models;

namespace RelayLab.Coordinator.Services;

// Invalidation only: review data continues through the actor-scoped HTTP API.
// Coalescing bounds each slow subscriber's queue; reconnect always reloads state.
public sealed class ReviewUpdates
{
    public sealed class Subscription(Actor actor, string authorization, Action remove) : IDisposable
    {
        public Actor Actor { get; } = actor;
        public string Authorization { get; } = authorization;
        public Channel<byte> Changes { get; } = Channel.CreateBounded<byte>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true
        });
        public void Dispose() { remove(); Changes.Writer.TryComplete(); }
    }
    private readonly object gate = new();
    private readonly Dictionary<Guid, Subscription> subscribers = new();
    public Subscription Subscribe(Actor actor, string authorization)
    {
        lock (gate)
        {
            if (subscribers.Count >= 128) throw new ApiFailure(429, "Too many live connections; use Refresh and retry later");
            var id = Guid.NewGuid();
            var subscription = new Subscription(actor, authorization, () => { lock (gate) subscribers.Remove(id); });
            subscribers.Add(id, subscription);
            return subscription;
        }
    }
    public void Publish(string researcherId)
    {
        lock (gate)
            foreach (var subscription in subscribers.Values)
                if (subscription.Actor.Role == "reviewer" || subscription.Actor.Id == researcherId)
                    subscription.Changes.Writer.TryWrite(0);
    }
    public void SessionRevoked(string authorization)
    {
        // Wake the sender so it rechecks the revoked token before sending anything.
        lock (gate)
            foreach (var subscription in subscribers.Values)
                if (subscription.Authorization == authorization) subscription.Changes.Writer.TryWrite(0);
    }
}
