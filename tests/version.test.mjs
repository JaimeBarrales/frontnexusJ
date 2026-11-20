import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Cada ?v= (en index.html y en los import entre módulos) debe ser la versión de package.json.
// Si un import queda sin ?v=, el navegador puede mezclar un app.js nuevo con un formato.js viejo
// de su caché y la página no arranca ("does not provide an export named ...").
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const leer = (ruta) => readFileSync(new URL(`../public/${ruta}`, import.meta.url), "utf8");

test("index.html carga CSS y JS con la versión de package.json", () => {
  const versiones = [...leer("index.html").matchAll(/\?v=([\w.-]+)/g)].map((m) => m[1]);
  assert.ok(versiones.length >= 2);
  for (const v of versiones) assert.equal(v, version);
});

test("los import entre módulos llevan ?v= con la versión de package.json", () => {
  for (const archivo of readdirSync(new URL("../public/js/", import.meta.url))) {
    const codigo = leer(`js/${archivo}`);
    for (const [, ruta] of codigo.matchAll(/from\s+"(\.[^"]+)"/g)) {
      assert.match(ruta, new RegExp(`\\?v=${version.replaceAll(".", "\\.")}$`), `${archivo} importa ${ruta} sin la versión ${version}`);
    }
  }
});
