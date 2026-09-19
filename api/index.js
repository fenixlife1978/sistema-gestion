// Single Vercel Function dispatcher.
// Vercel Hobby limits a deployment to 12 bundled Serverless Functions.
// Keep only this entry point exposed by Vercel; route handlers are loaded lazily
// so an unrelated handler cannot crash the whole /api function at startup.

const handlers = {
  "auth/login": "./auth/login",
  "auth/session": "./auth/session",
  "auth/logout": "./auth/logout",
  "health": "./health",
  "bootstrap": "./bootstrap",
  "duplicidades/autorizar": "./duplicidades/autorizar",
  "personas/registrar": "./personas/registrar",
  "personas/asignar-cargo": "./personas/asignar-cargo",
  "comite/gestionar": "./comite/gestionar",
  "mesas/miembros": "./mesas/miembros",
  "verificaciones": "./verificaciones",
  "actas": "./actas",
  "cortes": "./cortes",
  "usuarios/gestionar": "./usuarios/gestionar",
  "sistema/vaciar": "./sistema/vaciar",
  "centros/gestionar": "./centros/gestionar",
  "padron/gestionar": "./padron/gestionar",
  "direccion/gestionar": "./direccion/gestionar",
  "auditar": "./auditar",
};

module.exports = async function handler(req, res) {
  let route = req.query && req.query.route;
  if (Array.isArray(route)) route = route.join("/");
  route = String(route || "").replace(/^\/+|\/+$/g, "");

  if (!route && req.url) {
    const pathname = String(req.url).split("?")[0].replace(/^\/+|\/+$/g, "");
    route = pathname.replace(/^api\//, "");
  }

  const modulePath = handlers[route];
  if (!modulePath) {
    return res.status(404).json({ error: "API route not found" });
  }

  try {
    const target = require(modulePath);
    if (typeof target !== "function") {
      return res.status(500).json({ error: "API handler is not callable" });
    }
    return await target(req, res);
  } catch (error) {
    console.error("[api-dispatcher] Handler failed:", route, error);
    return res.status(500).json({
      error: "Internal server error",
      route,
      detail: process.env.NODE_ENV === "development"
        ? (error?.message || String(error))
        : undefined
    });
  }
};
