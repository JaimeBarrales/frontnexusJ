import { RUTAS, cargarConfig, pedir, pedirPrediccion } from "./api.js";
import {
  describirError,
  escalarPuntajes,
  formatearFecha,
  formatearPrecio,
  normalizarPrediccion,
  validarEntrada,
} from "./formato.js";

const $ = (id) => document.getElementById(id);
const INTERVALO_SALUD_MS = 5000;

let config = null;
let ultimaPeticion = null;

async function iniciar() {
  config = await cargarConfig();
  $("ruta-prediccion").textContent = config.rutaPrediccion;

  $("formulario").addEventListener("submit", (e) => {
    e.preventDefault();
    const k = new FormData(e.target).get("k");
    recomendar($("usuario").value, k);
  });
  $("reintentar").addEventListener("click", () => {
    if (ultimaPeticion) recomendar(ultimaPeticion.usuarioId, ultimaPeticion.k);
  });

  revisarSalud();
  setInterval(revisarSalud, INTERVALO_SALUD_MS);
  cargarClientesDeEjemplo();

  // Permite abrir la página con ?cliente=U100406 para la demostración.
  const cliente = new URLSearchParams(location.search).get("cliente");
  if (cliente) {
    $("usuario").value = cliente;
    recomendar(cliente, 8);
  }
}

// ------------------------------------------------------------------ flujo principal

async function recomendar(usuarioIdCrudo, kCrudo) {
  const entrada = validarEntrada(usuarioIdCrudo, kCrudo);
  const mensajeCampo = $("mensaje-campo");
  if (!entrada.ok) {
    mensajeCampo.textContent = entrada.mensaje;
    mensajeCampo.hidden = false;
    $("usuario").setAttribute("aria-invalid", "true");
    $("usuario").focus();
    return;
  }
  mensajeCampo.hidden = true;
  $("usuario").removeAttribute("aria-invalid");
  ultimaPeticion = entrada;

  ocupado(true);
  const r = await pedirPrediccion(config, entrada.usuarioId, entrada.k);
  ocupado(false);

  if (!r.ok) {
    mostrarError(describirError(r.estado, r.cuerpo, servicioDeRuta(config.rutaPrediccion)));
    return;
  }
  mostrarPrediccion(normalizarPrediccion(r.cuerpo), entrada.usuarioId, r.ms);
  cargarContexto(entrada.usuarioId);

  const url = new URL(location.href);
  url.searchParams.set("cliente", entrada.usuarioId);
  history.replaceState(null, "", url);
}

function ocupado(si) {
  $("boton").disabled = si;
  $("boton").textContent = si ? "Buscando productos…" : "Recomendar productos";
  $("vitrina").setAttribute("aria-busy", String(si));
  $("vitrina").classList.toggle("cargando", si);
}

function mostrarError(error) {
  $("aviso").hidden = false;
  $("aviso").className = "aviso error";
  $("aviso-titulo").textContent = error.titulo;
  $("aviso-detalle").textContent = error.detalle;
  $("aviso-tecnico").textContent = error.tecnico;
  $("reintentar").hidden = false;
  $("titulo-vitrina").textContent = "Vitrina";
  $("subtitulo-vitrina").textContent = "No se pudieron obtener recomendaciones.";
  $("detalle").hidden = true;
  pintarVacia(4);
}

function mostrarPrediccion(p, usuarioId, ms) {
  const vitrina = $("vitrina");
  const esModelo = p.origen === "modelo";
  vitrina.dataset.origen = esModelo ? "modelo" : "fallback";

  $("titulo-vitrina").textContent = `Vitrina de ${p.usuarioId ?? usuarioId}`;
  $("subtitulo-vitrina").textContent = esModelo
    ? "Ordenada por el modelo: el primer producto es el que tiene más probabilidad de compra."
    : "Lista general de más vendidos. No está personalizada para este cliente.";

  if (!esModelo && p.motivo) {
    $("aviso").hidden = false;
    $("aviso").className = "aviso fallback";
    $("aviso-titulo").textContent = "Se usó el plan B";
    $("aviso-detalle").textContent = primeraMayuscula(p.motivo) + ".";
    $("aviso-tecnico").textContent = "";
    $("reintentar").hidden = true;
  } else {
    $("aviso").hidden = true;
  }

  pintarGondola(p.recomendaciones, esModelo);

  $("detalle").hidden = false;
  $("d-origen").textContent = esModelo ? "Modelo personalizado" : "Más vendidos (plan B)";
  $("d-version").textContent = p.versionModelo ?? "No informada";
  $("d-latencia").textContent = `${ms} ms`;
  $("d-id").textContent = p.id !== null && p.id !== undefined ? `Predicción ${p.id}` : "No guardada";
  $("d-fecha").textContent = p.fecha ? formatearFecha(p.fecha) : formatearFecha(new Date().toISOString());
}

function pintarGondola(recomendaciones, esModelo) {
  const gondola = $("gondola");
  gondola.replaceChildren();
  if (recomendaciones.length === 0) {
    pintarVacia(4);
    $("subtitulo-vitrina").textContent = "El servicio respondió sin productos para recomendar.";
    return;
  }
  const anchos = escalarPuntajes(recomendaciones);
  recomendaciones.forEach((r, i) => {
    const li = el("li", { class: `etiqueta ${esModelo ? "" : "general"}`.trim() });
    li.style.setProperty("--i", i);
    li.append(
      el("span", { class: "puesto", "aria-label": `Puesto ${r.puesto}` }, String(r.puesto)),
      el("p", { class: "categoria" }, r.categoria ? primeraMayuscula(r.categoria) : "Sin categoría"),
      el("p", { class: "marca-producto" }, r.marca ?? "Marca no informada"),
      el("p", { class: "precio" }, formatearPrecio(r.precio)),
      el("p", { class: "sku" }, `SKU ${r.sku}`),
    );
    if (anchos[i] !== null) {
      const barra = el("div", { class: "afinidad", title: `Puntaje ${r.puntaje}` });
      const relleno = el("span");
      relleno.style.width = `${anchos[i]}%`;
      barra.append(relleno);
      li.append(barra, el("p", { class: "puntaje" }, `Puntaje ${Number(r.puntaje).toFixed(2)}`));
    }
    gondola.append(li);
  });
}

function pintarVacia(n) {
  const gondola = $("gondola");
  gondola.replaceChildren(...Array.from({ length: n }, () => el("li", { class: "etiqueta vacia", "aria-hidden": "true" })));
}

// ------------------------------------------------------------------ datos de apoyo (opcionales)

async function cargarContexto(usuarioId) {
  $("contexto").hidden = false;
  $("compras").replaceChildren(el("p", { class: "cargando-texto" }, "Cargando compras…"));
  $("historial").replaceChildren(el("p", { class: "cargando-texto" }, "Cargando recomendaciones anteriores…"));

  const [compras, historial] = await Promise.all([
    pedir(RUTAS.compras(usuarioId, 8), { timeoutMs: 5000 }),
    pedir(RUTAS.prediccionesDe(usuarioId, 5), { timeoutMs: 5000 }),
  ]);

  if (compras.ok && Array.isArray(lista(compras.cuerpo))) {
    const filas = lista(compras.cuerpo);
    if (filas.length === 0) {
      $("compras").replaceChildren(el("p", { class: "vacio" }, "Este cliente no tiene compras registradas."));
    } else {
      const tabla = el("table");
      tabla.append(
        el("thead", {}, fila(["Producto", "Fecha", "Unid."], "th")),
        el("tbody", {}, ...filas.map((c) => fila([
          `${c.marca ?? ""} ${c.categoria ?? ""}`.trim() || c.sku,
          c.fecha ? formatearFecha(c.fecha).slice(0, 10) : "—",
          String(c.cantidad ?? "—"),
        ]))),
      );
      $("compras").replaceChildren(tabla);
    }
  } else {
    $("compras").replaceChildren(noDisponible(compras));
  }

  if (historial.ok && Array.isArray(lista(historial.cuerpo))) {
    const filas = lista(historial.cuerpo).map(normalizarPrediccion);
    if (filas.length === 0) {
      $("historial").replaceChildren(el("p", { class: "vacio" }, "Es la primera recomendación para este cliente."));
    } else {
      const ul = el("ul", { class: "historial" });
      filas.forEach((p) => {
        ul.append(el("li", {},
          el("span", { class: "h-fecha" }, p.fecha ? formatearFecha(p.fecha) : "Sin fecha"),
          el("span", { class: `h-origen ${p.origen}` }, p.origen === "modelo" ? "Modelo" : "Plan B"),
          el("span", { class: "h-version" }, p.versionModelo ?? ""),
        ));
      });
      $("historial").replaceChildren(ul);
    }
  } else {
    $("historial").replaceChildren(noDisponible(historial));
  }
}

async function cargarClientesDeEjemplo() {
  const r = await pedir(RUTAS.usuarios(6), { timeoutMs: 5000 });
  const usuarios = r.ok ? lista(r.cuerpo) : null;
  if (!Array.isArray(usuarios) || usuarios.length === 0) return;

  const datalist = $("clientes");
  const botones = $("lista-ejemplos");
  usuarios.forEach((u) => {
    const id = u.usuario_id ?? u.id;
    if (!id) return;
    datalist.append(el("option", { value: id }));
    const b = el("button", { type: "button", class: "ejemplo" }, id);
    if (u.region) b.append(el("small", {}, ` ${primeraMayuscula(u.region)}`));
    b.addEventListener("click", () => {
      $("usuario").value = id;
      recomendar(id, new FormData($("formulario")).get("k"));
    });
    botones.append(b);
  });
  $("ejemplos").hidden = false;
}

function noDisponible(r) {
  const e = describirError(r.estado, r.cuerpo, "dominio");
  return el("p", { class: "vacio" }, `No disponible: ${e.titulo.toLowerCase()}.`);
}

// ------------------------------------------------------------------ estado de los servicios

async function revisarSalud() {
  const [gw, dom, ia] = await Promise.all([
    pedir(RUTAS.saludGateway, { timeoutMs: 3000 }),
    pedir(RUTAS.saludDominio, { timeoutMs: 3000 }),
    pedir(RUTAS.saludIa, { timeoutMs: 3000 }),
  ]);
  marcar("gateway", gw);
  marcar("dominio", dom);
  marcar("ia", ia);
}

function marcar(servicio, r) {
  const li = document.querySelector(`[data-servicio="${servicio}"]`);
  let estado = "caido";
  let texto = "sin respuesta";
  if (r.ok) {
    estado = "ok";
    texto = "en línea";
  } else if (r.estado === 503) {
    estado = "degradado";
    texto = "sin modelo";
  } else if (r.estado === 504) {
    estado = "degradado";
    texto = "lento";
  } else if (r.estado === 502) {
    texto = "caído";
  }
  li.dataset.estado = estado;
  li.querySelector(".estado").textContent = texto;
  li.title = `${r.estado || "sin respuesta"} en ${r.ms} ms`;
}

// ------------------------------------------------------------------ utilidades

function el(tag, attrs = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...hijos);
  return n;
}

function fila(celdas, tipo = "td") {
  return el("tr", {}, ...celdas.map((c) => el(tipo, {}, c)));
}

function lista(cuerpo) {
  if (Array.isArray(cuerpo)) return cuerpo;
  if (cuerpo && typeof cuerpo === "object") return cuerpo.items ?? cuerpo.datos ?? cuerpo.resultados ?? null;
  return null;
}

function servicioDeRuta(ruta) {
  const m = /^\/api\/([^/]+)\//.exec(ruta);
  return m ? m[1] : "dominio";
}

function primeraMayuscula(t) {
  return String(t).charAt(0).toUpperCase() + String(t).slice(1);
}

iniciar();
