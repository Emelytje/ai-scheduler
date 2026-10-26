/*
 * AI Scheduler embed loader.
 * <div data-ai-scheduler data-token="EMBED_TOKEN" data-view="week" data-height="720"></div>
 * <script src="https://YOUR-DEPLOYMENT/embed.js" async></script>
 * Emits DOM events on the container: "ai-scheduler:plan" (detail: { atRisk, plannedAt }).
 */
(function () {
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : window.location.origin;

  function mount(el) {
    if (el.__aiScheduler) return;
    var url = new URL("/embed", origin);
    if (el.dataset.token) url.searchParams.set("token", el.dataset.token);
    var frame = document.createElement("iframe");
    frame.src = url.toString();
    frame.title = el.dataset.title || "Task planner";
    frame.style.cssText = "width:100%;border:0;display:block;min-height:480px;height:" + (el.dataset.height || "720") + "px";
    frame.setAttribute("allow", "clipboard-write");
    el.__aiScheduler = frame;
    el.appendChild(frame);

    window.addEventListener("message", function (e) {
      if (e.origin !== origin || e.source !== frame.contentWindow || !e.data) return;
      if (e.data.type === "ai-scheduler:resize" && !el.dataset.height) frame.style.height = Math.max(480, e.data.height) + "px";
      if (e.data.type === "ai-scheduler:plan") el.dispatchEvent(new CustomEvent("ai-scheduler:plan", { detail: e.data, bubbles: true }));
    });
    frame.addEventListener("load", function () {
      if (el.dataset.view) frame.contentWindow.postMessage({ type: "ai-scheduler:set-view", view: el.dataset.view }, origin);
    });
  }

  function mountAll() {
    document.querySelectorAll("[data-ai-scheduler]").forEach(mount);
  }
  window.AIScheduler = { mount: mount, mountAll: mountAll };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
})();
