// Funciones puras: no tocan el DOM ni la red. Se prueban con `node --test`.

export const K_MIN = 4;
export const K_MAX = 8;

const NOMBRES_SERVICIO = {
  gateway: "el gateway",
  front: "el front",
  dominio: "el servicio de dominio",
  ia: "el servicio de recomendaciones (IA)",
};

export function nombreServicio(servicio) {
  return NOMBRES_SERVICIO[servicio] ?? `el servicio «${servicio}»`;
}

/** 75389 -> "$75.389" (pesos chilenos, sin decimales). */
export function formatearPrecio(valor) {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return "Sin precio";
  const entero = Math.round(Number(valor));
  return "$" + entero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "2026-10-14T20:15:03Z" -> "14-10-2026 17:15" en hora de Chile. */
export function formatearFecha(texto, zona = "America/Santiago") {
  if (!texto) return "—";
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return String(texto);
  const partes = new Intl.DateTimeFormat("es-CL", {
    timeZone: zona,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(fecha);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

/** Valida lo que escribe el usuario antes de llamar a la API. */
export function validarEntrada(usuarioId, k) {
  const id = String(usuarioId ?? "").trim();
  const n = Number(k);
  if (!id) return { ok: false, mensaje: "Escribe el código del cliente, por ejemplo U100406." };
  if (id.length > 40) return { ok: false, mensaje: "El código del cliente es demasiado largo." };
  if (!Number.isInteger(n) || n < K_MIN || n > K_MAX) {
    return { ok: false, mensaje: `La cantidad de productos va de ${K_MIN} a ${K_MAX}.` };
  }
  return { ok: true, usuarioId: id, k: n };
}

/**
 * Traduce una respuesta fallida (del gateway o del servicio) a un mensaje para la pantalla.
 * `estado` 0 significa que ni siquiera hubo respuesta HTTP.
 */
export function describirError(estado, cuerpo, servicioPorDefecto = "dominio") {
  const servicio = (cuerpo && typeof cuerpo === "object" && cuerpo.servicio) || servicioPorDefecto;
  const nombre = nombreServicio(servicio);
  const codigo = cuerpo && typeof cuerpo === "object" ? cuerpo.error : undefined;

  if (estado === 0) {
    return {
      titulo: "No hay conexión con el gateway",
      detalle: "El navegador no recibió respuesta. Revisa que el sistema esté levantado en http://localhost:8080.",
      tecnico: "sin respuesta HTTP",
    };
  }
  if (estado === 502 || codigo === "servicio_no_disponible") {
    return {
      titulo: `No responde ${nombre}`,
      detalle: "El gateway no pudo conectarse con ese contenedor. Si se está reiniciando, vuelve a intentar en unos segundos.",
      tecnico: `502 servicio_no_disponible (${servicio})`,
    };
  }
  if (estado === 504 || codigo === "tiempo_de_espera_agotado") {
    return {
      titulo: `${capitalizar(nombre)} tardó demasiado`,
      detalle: "El gateway esperó 10 segundos y cortó la petición. Vuelve a intentar.",
      tecnico: `504 tiempo_de_espera_agotado (${servicio})`,
    };
  }
  if (estado === 503) {
    return {
      titulo: `${capitalizar(nombre)} no puede atender ahora`,
      detalle: cuerpo && typeof cuerpo.detail === "string"
        ? `${cuerpo.detail}. Revisa su /health y vuelve a intentar.`
        : "El servicio respondió, pero no está listo (por ejemplo, sin el modelo cargado). Revisa su /health.",
      tecnico: `503: ${textoDetalle(cuerpo)}`,
    };
  }
  if (estado === 422 || estado === 400) {
    return {
      titulo: "Los datos enviados no son válidos",
      detalle: `El cliente es obligatorio y la cantidad va de ${K_MIN} a ${K_MAX}.`,
      tecnico: `${estado}: ${textoDetalle(cuerpo)}`,
    };
  }
  if (estado === 404) {
    return {
      titulo: codigo === "ruta_no_encontrada" ? "El gateway no conoce esa ruta" : "No se encontró lo pedido",
      detalle: "Revisa que la ruta del front coincida con la del gateway y la del servicio.",
      tecnico: `404: ${codigo ?? textoDetalle(cuerpo)}`,
    };
  }
  return {
    titulo: "Algo falló al pedir las recomendaciones",
    detalle: "El servicio respondió con un error inesperado.",
    tecnico: `${estado}: ${textoDetalle(cuerpo)}`,
  };
}

/**
 * El dominio puede devolver la predicción plana o envuelta en `prediccion`.
 * Se normaliza a una sola forma para pintar la pantalla.
 */
export function normalizarPrediccion(cuerpo) {
  const p = cuerpo && typeof cuerpo === "object" && cuerpo.prediccion ? { ...cuerpo, ...cuerpo.prediccion } : cuerpo ?? {};
  const recomendaciones = Array.isArray(p.recomendaciones) ? p.recomendaciones : [];
  return {
    id: p.id ?? p.prediccion_id ?? null,
    usuarioId: p.usuario_id ?? null,
    origen: p.origen ?? "desconocido",
    motivo: p.motivo ?? null,
    versionModelo: p.version_modelo ?? p.modelo_version ?? p.version ?? null,
    fecha: p.fecha ?? p.creado_en ?? null,
    recomendaciones: recomendaciones
      .map((r, i) => ({
        puesto: Number(r.puesto ?? i + 1),
        sku: String(r.sku ?? "—"),
        categoria: r.categoria ?? null,
        marca: r.marca ?? null,
        precio: r.precio_lista ?? r.precio ?? null,
        puntaje: r.puntaje ?? null,
      }))
      .sort((a, b) => a.puesto - b.puesto),
  };
}

/** Ancho relativo (0–100) de la barra de puntaje dentro de una misma recomendación. */
export function escalarPuntajes(recomendaciones) {
  const valores = recomendaciones.map((r) => r.puntaje).filter((v) => typeof v === "number");
  if (valores.length === 0) return recomendaciones.map(() => null);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  return recomendaciones.map((r) => {
    if (typeof r.puntaje !== "number") return null;
    if (max === min) return 100;
    return Math.round(30 + (70 * (r.puntaje - min)) / (max - min));
  });
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function textoDetalle(cuerpo) {
  if (cuerpo === null || cuerpo === undefined) return "sin cuerpo";
  if (typeof cuerpo === "string") return cuerpo.slice(0, 160);
  if (typeof cuerpo.detail === "string") return cuerpo.detail;
  try {
    return JSON.stringify(cuerpo.detail ?? cuerpo).slice(0, 160);
  } catch {
    return "cuerpo no legible";
  }
}
