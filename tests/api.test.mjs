import { test } from "node:test";
import assert from "node:assert/strict";

import { cargarConfig, pedir, pedirPrediccion } from "../public/js/api.js";

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
