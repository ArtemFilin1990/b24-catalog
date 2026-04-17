export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ping") {
      return Response.json({
        ok: true,
        app: "b24-catalog",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/install") {
      return env.ASSETS.fetch(new Request(`${url.origin}/install.html`, request));
    }

    if (url.pathname === "/" || url.pathname === "/app") {
      return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
    }

    return env.ASSETS.fetch(request);
  },
};
