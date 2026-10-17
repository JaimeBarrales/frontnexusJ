// Llamadas HTTP. Todas las rutas son relativas: el navegador habla solo con el gateway (puerto 8080).

const CONFIG_POR_DEFECTO = {
  // Ruta del flujo principal. El dominio llama a la IA y guarda la predicción en la base.
  rutaPrediccion: "/api/dominio/predicciones",
};

export const RUTAS = {
  saludGateway: "/health",
  saludDominio: "/api/dominio/health",
  saludIa: "/api/ia/health",
  usuarios: (limite) => `/api/dominio/usuarios?limite=${limite}`,
  compras: (id, limite) => `/api/dominio/usuarios/${encodeURIComponent(id)}/compras?limite=${limite}`,
  prediccionesDe: (id, limite) => `/api/dominio/predicciones?usuario_id=${encodeURIComponent(id)}&limite=${limite}`,
};

/** /config.json lo genera el Nginx del front a partir de variables de entorno (ver nginx/default.conf.template). */
export async function cargarConfig(fetchFn = fetch) {
  try {
    const r = await pedir("/config.json", { timeoutMs: 2000, fetchFn });
    if (r.ok && r.cuerpo && typeof r.cuerpo === "object") {
      return { ...CONFIG_POR_DEFECTO, ...limpiar(r.cuerpo) };
    }
  } catch {
    /* se usan los valores por defecto */
  }
  return { ...CONFIG_POR_DEFECTO };
}

/**
 * fetch con tiempo límite. Nunca lanza: devuelve { ok, estado, cuerpo, ms }.
 * estado = 0 cuando no hubo respuesta HTTP (red caída o tiempo agotado en el navegador).
 */
export async function pedir(ruta, { metodo = "GET", cuerpo, timeoutMs = 15000, fetchFn = fetch } = {}) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);
  const inicio = performance.now();
  try {
    const respuesta = await fetchFn(ruta, {
      method: metodo,
      headers: cuerpo === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
      cache: "no-store",
    });
    const texto = await respuesta.text();
    let datos = texto;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      /* no era JSON: se deja como texto */
    }
    return { ok: respuesta.ok, estado: respuesta.status, cuerpo: datos, ms: Math.round(performance.now() - inicio) };
  } catch (e) {
    return { ok: false, estado: 0, cuerpo: { error: e?.name === "AbortError" ? "tiempo_agotado_navegador" : "sin_conexion" }, ms: Math.round(performance.now() - inicio) };
  } finally {
    clearTimeout(reloj);
  }
}

export function pedirPrediccion(config, usuarioId, k, fetchFn = fetch) {
  return pedir(config.rutaPrediccion, { metodo: "POST", cuerpo: { usuario_id: usuarioId, k }, timeoutMs: 15000, fetchFn });
}

function limpiar(obj) {
  // Un ${VAR} sin reemplazar o un valor vacío no debe pisar el valor por defecto.
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === "string" && v.startsWith("/")));
}
