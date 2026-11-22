// Llamadas HTTP. Todas las rutas son relativas: el navegador habla solo con el gateway.

const CONFIG_POR_DEFECTO = {
  // Ruta del flujo principal. El dominio llama a la IA y guarda la predicción en la base.
  rutaPrediccion: "/api/dominio/predicciones",
  // Campañas con LLM (tarea 1): POST {ruta}/{usuario} -> 202 con id; GET {ruta}/{id} -> estado.
  rutaCampanas: "/api/dominio/campanas",
};

export const RUTAS = {
  saludGateway: "/health",
  dashboard: "/api/dashboard",
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
export async function pedir(ruta, { metodo = "GET", cuerpo, timeoutMs = 15000, clave, fetchFn = fetch } = {}) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);
  const inicio = performance.now();
  const cabeceras = { Accept: "application/json" };
  if (cuerpo !== undefined) cabeceras["Content-Type"] = "application/json";
  // La clave solo viaja si la persona la escribió (tarea 2: X-API-Key). Sin clave, la cabecera no se envía.
  if (clave) cabeceras["X-API-Key"] = clave;
  try {
    const respuesta = await fetchFn(ruta, {
      method: metodo,
      headers: cabeceras,
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

export function pedirPrediccion(config, usuarioId, k, fetchFn = fetch, clave = "") {
  return pedir(config.rutaPrediccion, { metodo: "POST", cuerpo: { usuario_id: usuarioId, k }, timeoutMs: 15000, clave, fetchFn });
}

// ------------------------------------------------------------------ campañas (LLM por cola)
// El navegador NUNCA llama al LLM: pide la campaña al dominio, que la deja en RabbitMQ,
// y después consulta el estado hasta que el worker la termina.

export const ESTADOS_FINALES = new Set(["listo", "error"]);

/** POST {rutaCampanas}/{usuario}. El dominio responde 202 con el id del trabajo. */
export function pedirCampana(config, usuarioId, { clave = "", fetchFn = fetch } = {}) {
  return pedir(`${config.rutaCampanas}/${encodeURIComponent(usuarioId)}`, { metodo: "POST", timeoutMs: 8000, clave, fetchFn });
}

/** GET {rutaCampanas}/{id}. */
export function consultarCampana(config, id, { clave = "", fetchFn = fetch } = {}) {
  return pedir(`${config.rutaCampanas}/${encodeURIComponent(id)}`, { timeoutMs: 5000, clave, fetchFn });
}

/**
 * Consulta el estado cada `intervaloMs` hasta que llega a `listo` o `error`, o hasta `maximoMs`.
 * Nunca queda colgada: siempre termina con un resultado.
 *   { final: true,  campana }                       -> estado listo o error
 *   { final: false, campana, motivo: "espera" }     -> se acabó el tiempo de espera
 *   { final: false, campana, motivo: "consulta", respuesta } -> la consulta respondió 4xx (no tiene sentido seguir)
 * `alCambiar(campana)` se llama cada vez que llega una respuesta válida (para pintar "pendiente").
 */
export async function esperarCampana(config, id, {
  clave = "",
  intervaloMs = 2000,
  maximoMs = 90000,
  fetchFn = fetch,
  dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
  ahora = () => Date.now(),
  alCambiar = () => {},
  normalizar = (c) => c,
} = {}) {
  const inicio = ahora();
  let ultima = null;
  for (;;) {
    const r = await consultarCampana(config, id, { clave, fetchFn });
    if (r.ok) {
      ultima = normalizar(r.cuerpo);
      alCambiar(ultima);
      if (ESTADOS_FINALES.has(ultima.estado)) return { final: true, campana: ultima };
    } else if (r.estado >= 400 && r.estado < 500 && r.estado !== 429) {
      // 401, 404, 422...: repetir no lo arregla. 429 y 5xx sí pueden pasar solos.
      return { final: false, campana: ultima, motivo: "consulta", respuesta: r };
    }
    if (ahora() - inicio + intervaloMs > maximoMs) return { final: false, campana: ultima, motivo: "espera" };
    await dormir(intervaloMs);
  }
}

// ------------------------------------------------------------------ clave de API
// La escribe quien usa el front y queda solo en esta pestaña (sessionStorage): nunca en el código ni en la imagen.
const LLAVE_CLAVE = "nexus_api_key";

export function leerClave(almacen = globalThis.sessionStorage) {
  try {
    return almacen?.getItem(LLAVE_CLAVE) ?? "";
  } catch {
    return "";
  }
}

export function guardarClave(clave, almacen = globalThis.sessionStorage) {
  const limpia = String(clave ?? "").trim();
  try {
    if (limpia) almacen?.setItem(LLAVE_CLAVE, limpia);
    else almacen?.removeItem(LLAVE_CLAVE);
  } catch {
    /* sin almacenamiento: la clave dura hasta recargar */
  }
  return limpia;
}

function limpiar(obj) {
  // Un ${VAR} sin reemplazar o un valor vacío no debe pisar el valor por defecto.
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === "string" && v.startsWith("/")));
}
