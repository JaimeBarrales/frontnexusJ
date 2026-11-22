import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describirError,
  describirEstadoCampana,
  escalarPuntajes,
  formatearFecha,
  formatearPrecio,
  normalizarCampana,
  normalizarPrediccion,
  validarEntrada,
} from "../public/js/formato.js";

test("formatea precios en pesos chilenos", () => {
  assert.equal(formatearPrecio(75389), "$75.389");
  assert.equal(formatearPrecio(1234567.6), "$1.234.568");
  assert.equal(formatearPrecio(900), "$900");
  assert.equal(formatearPrecio(null), "Sin precio");
  assert.equal(formatearPrecio("abc"), "Sin precio");
});

test("formatea fechas en hora de Chile", () => {
  assert.equal(formatearFecha("2026-10-14T23:15:00Z"), "14-10-2026 20:15");
  assert.equal(formatearFecha(null), "—");
  assert.equal(formatearFecha("no-es-fecha"), "no-es-fecha");
});

test("valida cliente y cantidad antes de llamar a la API", () => {
  assert.deepEqual(validarEntrada("  U100406 ", "8"), { ok: true, usuarioId: "U100406", k: 8 });
  assert.equal(validarEntrada("", 8).ok, false);
  assert.equal(validarEntrada("U1", 3).ok, false);
  assert.equal(validarEntrada("U1", 9).ok, false);
  assert.equal(validarEntrada("U1", "6.5").ok, false);
});

test("traduce los errores JSON del gateway", () => {
  const caido = describirError(502, { error: "servicio_no_disponible", servicio: "ia" });
  assert.match(caido.titulo, /IA/);
  assert.equal(caido.tecnico, "502 servicio_no_disponible (ia)");

  const lento = describirError(504, { error: "tiempo_de_espera_agotado", servicio: "dominio" });
  assert.match(lento.titulo, /tardó demasiado/);

  assert.match(describirError(0, null).titulo, /gateway/);
  const sinModelo = describirError(503, { detail: "El modelo no está disponible" }, "ia");
  assert.match(sinModelo.tecnico, /modelo/);
  assert.match(sinModelo.detalle, /^El modelo no está disponible\./);
  assert.match(describirError(422, { detail: [] }).titulo, /no son válidos/);
  assert.match(describirError(404, { error: "ruta_no_encontrada" }).titulo, /ruta/);
});

test("normaliza la respuesta de la IA tal como la entrega hoy", () => {
  const p = normalizarPrediccion({
    usuario_id: "U100001",
    origen: "modelo",
    motivo: null,
    recomendaciones: [
      { puesto: 2, sku: "NX-2", categoria: "redes", marca: "Dell", precio_lista: 100, puntaje: 1.5 },
      { puesto: 1, sku: "NX-1", categoria: "cables", marca: "Kingston", precio_lista: 200, puntaje: 2.8 },
    ],
  });
  assert.equal(p.origen, "modelo");
  assert.equal(p.versionModelo, null);
  assert.deepEqual(p.recomendaciones.map((r) => r.sku), ["NX-1", "NX-2"]);
  assert.equal(p.recomendaciones[0].precio, 200);
});

test("normaliza la respuesta del dominio (plana o envuelta)", () => {
  const plana = normalizarPrediccion({ id: 7, version_modelo: "hgb-a1b2c3d", fecha: "2026-10-14T20:00:00Z", origen: "fallback", motivo: "x", recomendaciones: [], atendido_por: "a1b2c3d4e5f6" });
  assert.equal(plana.id, 7);
  assert.equal(plana.atendidoPor, "a1b2c3d4e5f6");
  assert.equal(plana.versionModelo, "hgb-a1b2c3d");
  const envuelta = normalizarPrediccion({ id: 8, prediccion: { origen: "modelo", recomendaciones: [{ sku: "A" }] } });
  assert.equal(envuelta.id, 8);
  assert.equal(envuelta.recomendaciones[0].puesto, 1);
});

test("escala los puntajes para dibujar las barras", () => {
  assert.deepEqual(escalarPuntajes([{ puntaje: 3 }, { puntaje: 2 }, { puntaje: 1 }]), [100, 65, 30]);
  assert.deepEqual(escalarPuntajes([{ puntaje: null }, { puntaje: null }]), [null, null]);
  assert.deepEqual(escalarPuntajes([{ puntaje: 2 }]), [100]);
});

test("401 y 429 tienen mensajes propios", () => {
  assert.match(describirError(401, { detail: "clave invalida" }).titulo, /clave de API/);
  assert.match(describirError(429, null).titulo, /Demasiadas peticiones/);
});

test("normaliza la campaña con los nombres de la tabla campanas", () => {
  const c = normalizarCampana({
    id: 3, usuario_id: "U100406", estado: "listo", texto: "  Hola  ", modelo_llm: "meta/llama-3.1-70b-instruct",
    intentos: 1, motivo_error: null, creada_en: "2026-11-20T12:00:00Z", actualizada_en: "2026-11-20T12:00:05Z",
  });
  assert.equal(c.id, 3);
  assert.equal(c.estado, "listo");
  assert.equal(c.texto, "Hola");
  assert.equal(c.degradado, false);
  assert.equal(c.modelo, "meta/llama-3.1-70b-instruct");
  assert.equal(c.intentos, 1);
});

test("lee la respuesta real de GET /campanas/{id} del dominio (creado_en, degradado)", () => {
  const c = normalizarCampana({
    id: 5, estado: "degradado", texto: "Descubre nuestras categorías y novedades disponibles.",
    modelo_llm: null, intentos: 3, motivo_error: "NVIDIA no respondió",
    creado_en: "2026-11-21T10:00:00+00:00", actualizado_en: "2026-11-21T10:00:12+00:00",
  });
  assert.equal(c.estado, "error");
  assert.equal(c.degradado, true);
  assert.equal(c.intentos, 3);
  assert.equal(c.motivo, "NVIDIA no respondió");
  assert.equal(c.creada, "2026-11-21T10:00:00+00:00");
  assert.equal(c.actualizada, "2026-11-21T10:00:12+00:00");
});

test("acepta la respuesta 202 con otros nombres de id y estados desconocidos", () => {
  assert.equal(normalizarCampana({ campana_id: 9 }).id, 9);
  assert.equal(normalizarCampana({ trabajo_id: "a1", estado: "PENDIENTE" }).estado, "pendiente");
  assert.equal(normalizarCampana({ campana: { id: 4, estado: "listo" } }).id, 4);
  assert.equal(normalizarCampana({ id: 1, estado: "procesando" }).estado, "pendiente");
  assert.equal(normalizarCampana(null).id, null);
});

test("error con texto es modo degradado; error sin texto no", () => {
  const degradado = normalizarCampana({ id: 1, estado: "error", texto: "Respaldo", motivo_error: "timeout" });
  assert.equal(degradado.degradado, true);
  assert.equal(describirEstadoCampana(degradado).clase, "alerta");
  assert.equal(normalizarCampana({ id: 1, estado: "degradado", texto: "R" }).estado, "error");

  const sinTexto = normalizarCampana({ id: 1, estado: "error", texto: "  " });
  assert.equal(sinTexto.degradado, false);
  assert.equal(describirEstadoCampana(sinTexto).etiqueta, "Error");

  assert.equal(describirEstadoCampana(normalizarCampana({ estado: "listo" })).clase, "ok");
  assert.equal(describirEstadoCampana(normalizarCampana({ estado: "pendiente" })).etiqueta, "Pendiente");
  assert.equal(describirEstadoCampana(null).etiqueta, "Sin pedir");
});
