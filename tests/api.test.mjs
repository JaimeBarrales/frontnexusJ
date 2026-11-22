import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cargarConfig,
  consultarCampana,
  esperarCampana,
  guardarClave,
  leerClave,
  pedir,
  pedirCampana,
  pedirPrediccion,
  RUTAS,
} from "../public/js/api.js";
import { normalizarCampana } from "../public/js/formato.js";

test("dashboard usa la ruta agregada del dominio", () => {
  assert.equal(RUTAS.dashboard, "/api/dashboard");
});

function respuesta(status, cuerpo) {
  const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(texto) });
}

test("envía la predicción por POST a la ruta configurada", async () => {
  let llamada;
  const fetchFalso = (url, opciones) => {
    llamada = { url, opciones };
    return respuesta(200, { origen: "modelo", recomendaciones: [] });
  };
  const r = await pedirPrediccion({ rutaPrediccion: "/api/dominio/predicciones" }, "U100406", 6, fetchFalso);
  assert.equal(r.ok, true);
  assert.equal(llamada.url, "/api/dominio/predicciones");
  assert.equal(llamada.opciones.method, "POST");
  assert.deepEqual(JSON.parse(llamada.opciones.body), { usuario_id: "U100406", k: 6 });
});

test("un 502 del gateway llega como cuerpo JSON, sin lanzar", async () => {
  const r = await pedir("/api/ia/predict", { fetchFn: () => respuesta(502, { error: "servicio_no_disponible", servicio: "ia" }) });
  assert.equal(r.ok, false);
  assert.equal(r.estado, 502);
  assert.equal(r.cuerpo.servicio, "ia");
});

test("sin red devuelve estado 0", async () => {
  const r = await pedir("/health", { fetchFn: () => Promise.reject(new TypeError("Failed to fetch")) });
  assert.equal(r.estado, 0);
  assert.equal(r.cuerpo.error, "sin_conexion");
});

test("respuestas que no son JSON se conservan como texto", async () => {
  const r = await pedir("/", { fetchFn: () => respuesta(500, "<html>error</html>") });
  assert.equal(r.cuerpo, "<html>error</html>");
});

test("config.json reemplaza la ruta solo si es válida", async () => {
  const ok = await cargarConfig(() => respuesta(200, { rutaPrediccion: "/api/ia/predict" }));
  assert.equal(ok.rutaPrediccion, "/api/ia/predict");
  const sinReemplazar = await cargarConfig(() => respuesta(200, { rutaPrediccion: "${RUTA_PREDICCION}" }));
  assert.equal(sinReemplazar.rutaPrediccion, "/api/dominio/predicciones");
  const caido = await cargarConfig(() => Promise.reject(new Error("x")));
  assert.equal(caido.rutaPrediccion, "/api/dominio/predicciones");
});

test("config.json trae la ruta de campañas y si falta usa /api/dominio/campanas", async () => {
  const conRuta = await cargarConfig(() => respuesta(200, { rutaPrediccion: "/api/predict", rutaCampanas: "/api/campanas" }));
  assert.equal(conRuta.rutaCampanas, "/api/campanas");
  const sinReemplazar = await cargarConfig(() => respuesta(200, { rutaCampanas: "${RUTA_CAMPANAS}" }));
  assert.equal(sinReemplazar.rutaCampanas, "/api/dominio/campanas");
});

// ------------------------------------------------------------------ clave de API

test("X-API-Key solo se envía cuando hay clave", async () => {
  const cabeceras = [];
  const fetchFalso = (_url, o) => {
    cabeceras.push(o.headers);
    return respuesta(200, {});
  };
  await pedirPrediccion({ rutaPrediccion: "/api/predict" }, "U1", 4, fetchFalso);
  await pedirPrediccion({ rutaPrediccion: "/api/predict" }, "U1", 4, fetchFalso, "secreta");
  assert.equal("X-API-Key" in cabeceras[0], false);
  assert.equal(cabeceras[1]["X-API-Key"], "secreta");
});

test("la clave se guarda recortada en el almacén de la pestaña y se borra vacía", () => {
  const datos = new Map();
  const almacen = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, v), removeItem: (k) => datos.delete(k) };
  assert.equal(guardarClave("  abc  ", almacen), "abc");
  assert.equal(leerClave(almacen), "abc");
  guardarClave("", almacen);
  assert.equal(leerClave(almacen), "");
  const roto = { getItem: () => { throw new Error("bloqueado"); } };
  assert.equal(leerClave(roto), "");
});

// ------------------------------------------------------------------ campañas

const CONFIG = { rutaCampanas: "/api/campanas" };

test("pide la campaña por POST a {ruta}/{usuario} y recibe 202", async () => {
  let llamada;
  const r = await pedirCampana(CONFIG, "U 100/406", {
    clave: "k",
    fetchFn: (url, o) => {
      llamada = { url, o };
      return respuesta(202, { id: 7, estado: "pendiente" });
    },
  });
  assert.equal(r.estado, 202);
  assert.equal(r.ok, true);
  assert.equal(llamada.url, "/api/campanas/U%20100%2F406");
  assert.equal(llamada.o.method, "POST");
  assert.equal(llamada.o.headers["X-API-Key"], "k");
});

test("consulta el estado por GET a {ruta}/{id}", async () => {
  let url;
  await consultarCampana(CONFIG, 7, { fetchFn: (u) => ((url = u), respuesta(200, {})) });
  assert.equal(url, "/api/campanas/7");
});

/** fetch falso que entrega las respuestas en orden y repite la última. */
function secuencia(...respuestas) {
  let i = 0;
  const f = () => {
    const [estado, cuerpo] = respuestas[Math.min(i, respuestas.length - 1)];
    i++;
    return respuesta(estado, cuerpo);
  };
  f.llamadas = () => i;
  return f;
}

/** Reloj falso: dormir avanza el tiempo sin esperar de verdad. */
function reloj() {
  let t = 0;
  return { ahora: () => t, dormir: (ms) => ((t += ms), Promise.resolve()) };
}

test("espera de pendiente a listo y avisa cada cambio", async () => {
  const fetchFn = secuencia([200, { id: 7, estado: "pendiente" }], [200, { id: 7, estado: "pendiente" }], [200, { id: 7, estado: "listo", texto: "Hola" }]);
  const vistos = [];
  const r = await esperarCampana(CONFIG, 7, { fetchFn, ...reloj(), normalizar: normalizarCampana, alCambiar: (c) => vistos.push(c.estado) });
  assert.equal(r.final, true);
  assert.equal(r.campana.estado, "listo");
  assert.equal(r.campana.texto, "Hola");
  assert.deepEqual(vistos, ["pendiente", "pendiente", "listo"]);
});

test("el modo degradado termina la espera con el texto de respaldo", async () => {
  const fetchFn = secuencia([200, { id: 7, estado: "error", texto: "Respaldo", motivo_error: "LLM 429 tras 3 intentos" }]);
  const r = await esperarCampana(CONFIG, 7, { fetchFn, ...reloj(), normalizar: normalizarCampana });
  assert.equal(r.final, true);
  assert.equal(r.campana.degradado, true);
  assert.equal(r.campana.motivo, "LLM 429 tras 3 intentos");
});

test("si el worker nunca termina, la espera se corta y no queda colgada", async () => {
  const fetchFn = secuencia([200, { id: 7, estado: "pendiente" }]);
  const r = await esperarCampana(CONFIG, 7, { fetchFn, ...reloj(), intervaloMs: 2000, maximoMs: 10000, normalizar: normalizarCampana });
  assert.equal(r.final, false);
  assert.equal(r.motivo, "espera");
  assert.equal(r.campana.estado, "pendiente");
  assert.ok(fetchFn.llamadas() <= 6);
});

test("un 5xx o 429 al consultar se reintenta; un 404 corta de inmediato", async () => {
  const conCaida = secuencia([502, { error: "servicio_no_disponible" }], [429, {}], [200, { id: 7, estado: "listo", texto: "ok" }]);
  const r1 = await esperarCampana(CONFIG, 7, { fetchFn: conCaida, ...reloj(), normalizar: normalizarCampana });
  assert.equal(r1.final, true);
  assert.equal(conCaida.llamadas(), 3);

  const noExiste = secuencia([404, { detail: "no existe" }]);
  const r2 = await esperarCampana(CONFIG, 999, { fetchFn: noExiste, ...reloj(), normalizar: normalizarCampana });
  assert.equal(r2.final, false);
  assert.equal(r2.motivo, "consulta");
  assert.equal(r2.respuesta.estado, 404);
  assert.equal(noExiste.llamadas(), 1);
});

test("sin red la espera tampoco queda colgada", async () => {
  const r = await esperarCampana(CONFIG, 7, {
    fetchFn: () => Promise.reject(new TypeError("Failed to fetch")),
    ...reloj(),
    maximoMs: 6000,
    normalizar: normalizarCampana,
  });
  assert.equal(r.final, false);
  assert.equal(r.motivo, "espera");
  assert.equal(r.campana, null);
});
