export type LiveStatus = "connecting" | "connected" | "reconnecting" | "manual";

// Only invalidations cross this socket. HTTP remains the authoritative, scoped read.
export function watchReviewUpdates(
  token: string,
  callbacks: { changed: () => void; status: (status: LiveStatus) => void; expired: () => void },
) {
  if (typeof WebSocket === "undefined") {
    callbacks.status("manual");
    return () => {};
  }
  let stopped = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1_000;
  function connect() {
    if (stopped || !navigator.onLine) return;
    clearTimeout(retry);
    callbacks.status("connecting");
    let current: WebSocket;
    try {
      const url = new URL(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/reviews/live`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      current = new WebSocket(url);
    } catch { callbacks.status("manual"); return; }
    socket = current;
    function armWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => current.close(), 40_000);
    }
    armWatchdog();
    current.onopen = () => current.send(JSON.stringify({ type: "subscribe", token }));
    current.onmessage = (message) => {
      if (stopped || current !== socket) return;
      armWatchdog();
      let event: { type?: string };
      try { event = JSON.parse(String(message.data)); } catch { current.close(); return; }
      if (event.type === "ready") {
        backoff = 1_000;
        callbacks.status("connected");
        callbacks.changed(); // subscribe first, then recover every missed change via HTTP
      } else if (event.type === "reviews-changed") callbacks.changed();
    };
    current.onclose = (event) => {
      if (stopped || current !== socket) return;
      clearTimeout(watchdog);
      if (event.code === 1008) { stopped = true; callbacks.expired(); return; }
      callbacks.status("reconnecting");
      if (navigator.onLine) {
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    };
    current.onerror = () => { /* onclose owns retry; browser errors carry no safe detail */ };
  }
  const offline = () => {
    clearTimeout(retry);
    callbacks.status("reconnecting");
    socket?.close();
  };
  const online = () => { if (!stopped) { socket?.close(); connect(); } };
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearTimeout(watchdog);
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
    socket?.close();
  };
}
