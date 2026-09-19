// Single Vercel Function dispatcher.
// Vercel Hobby limits a deployment to 12 bundled Serverless Functions.
// Keeping the route handlers as modules and exposing one entry point avoids
// turning every file under /api into a separate deployed function.

const handlers = {
  "auth/login": require("./auth/login"),
  "auth/session": require("./auth/session"),
  "auth/logout": require("./auth/logout"),
  "health": require("./health"),
  "bootstrap": require("./bootstrap"),
  "duplicidades/autorizar": require("./duplicidades/autorizar"),
  "personas/registrar": require("./personas/registrar"),
  "personas/asignar-cargo": require("./personas/asignar-cargo"),
  "comite/gestionar": require("./comite/gestionar"),
  "mesas/miembros": require("./mesas/miembros"),
  "verificaciones": require("./verificaciones"),
  "actas": require("./actas"),
  "cortes": require("./cortes"),
  "usuarios/gestionar": require("./usuarios/gestionar"),
  "sistema/vaciar": require("./sistema/vaciar"),
  "centros/gestionar": require("./centros/gestionar"),
  "padron/gestionar": require("./padron/gestionar"),
  "direccion/gestionar": require("./direccion/gestionar"),
  "auditar": require("./auditar"),
};

module.exports = async function handler(req, res) {
  // The rewrite adds ?route=<original-api-path>.
  // Fallback to the request pathname so the function also remains usable
  // when invoked directly during local development.
  let route = req.query && req.query.route;
  if (Array.isArray(route)) route = route.join("/");
  route = String(route || "").replace(/^\/+|\/+$/g, "");

  if (!route && req.url) {
    const pathname = String(req.url).split("?")[0].replace(/^\/+|\/+$/g, "");
    route = pathname.replace(/^api\//, "");
  }

  const target = handlers[route];
  if (typeof target !== "function") {
    return res.status(404).json({ error: "API route not found" });
  }

  return target(req, res);
};
