import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describirError,
  escalarPuntajes,
  formatearFecha,
  formatearPrecio,
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
  const plana = normalizarPrediccion({ id: 7, version_modelo: "hgb-a1b2c3d", fecha: "2026-10-14T20:00:00Z", origen: "fallback", motivo: "x", recomendaciones: [] });
  assert.equal(plana.id, 7);
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
