import { RUTAS, cargarConfig, esperarCampana, guardarClave, leerClave, pedir, pedirCampana, pedirPrediccion } from "./api.js?v=1.2.2";
import {
  describirError,
  describirEstadoCampana,
  escalarPuntajes,
  formatearFecha,
  formatearPrecio,
  normalizarCampana,
  normalizarPrediccion,
  validarEntrada,
} from "./formato.js?v=1.2.2";

const $ = (id) => document.getElementById(id);
const INTERVALO_SALUD_MS = 5000;

let config = null;
let ultimaPeticion = null;
let clave = "";
// Cada pedido de campaña sube este número; una espera vieja que termina tarde no pisa la pantalla.
let turnoCampana = 0;
let clienteCampana = null;

async function iniciar() {
  config = await cargarConfig();
  $("ruta-prediccion").textContent = config.rutaPrediccion;
  $("ruta-campanas").textContent = config.rutaCampanas;

  clave = leerClave();
  $("clave-estado").textContent = clave ? "Clave guardada en esta pestaña." : "";
  $("form-clave").addEventListener("submit", (e) => {
    e.preventDefault();
    clave = guardarClave($("clave").value);
    $("clave").value = "";
    $("clave-estado").textContent = clave ? "Clave guardada en esta pestaña." : "Sin clave.";
  });

  $("boton-campana").addEventListener("click", () => {
    if (clienteCampana) generarCampana(clienteCampana);
  });

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
  const r = await pedirPrediccion(config, entrada.usuarioId, entrada.k, fetch, clave);
  ocupado(false);

  if (!r.ok) {
    mostrarError(describirError(r.estado, r.cuerpo, servicioDeRuta(config.rutaPrediccion)));
    return;
  }
  mostrarPrediccion(normalizarPrediccion(r.cuerpo), entrada.usuarioId, r.ms);
  prepararCampana(entrada.usuarioId);
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
  $("d-fecha").textContent = p.fecha ? formatearFecha(p.fecha) : "No informada";
  $("d-replica").textContent = p.atendidoPor ?? "No informada";
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

// ------------------------------------------------------------------ campaña con LLM (por cola)
// La predicción ya se mostró: la campaña es aparte y nunca bloquea ni rompe la vitrina.

function prepararCampana(usuarioId) {
  if (clienteCampana === usuarioId) return;
  clienteCampana = usuarioId;
  turnoCampana++; // descarta una espera en curso de otro cliente
  $("campana").hidden = false;
  $("titulo-campana").textContent = `Campaña para ${usuarioId}`;
  $("boton-campana").disabled = false;
  $("boton-campana").textContent = "Generar campaña";
  pintarEstadoCampana(null, "");
  $("aviso-campana").hidden = true;
  $("texto-campana").hidden = true;
}

async function generarCampana(usuarioId) {
  const turno = ++turnoCampana;
  const vigente = () => turno === turnoCampana;
  $("boton-campana").disabled = true;
  $("boton-campana").textContent = "Generando…";
  $("aviso-campana").hidden = true;
  $("texto-campana").hidden = true;
  pintarEstadoCampana({ estado: "pendiente" }, "Enviando el pedido…");

  try {
    const r = await pedirCampana(config, usuarioId, { clave });
    if (!vigente()) return;
    const inicial = r.ok ? normalizarCampana(r.cuerpo) : null;
    if (!r.ok || inicial.id === null) {
      const e = r.ok
        ? { titulo: "El dominio no devolvió un identificador", detalle: "No se puede consultar el estado sin el id del trabajo.", tecnico: `${r.estado}: ${JSON.stringify(r.cuerpo).slice(0, 160)}` }
        : describirError(r.estado, r.cuerpo, "dominio");
      pintarEstadoCampana(null, "");
      avisoCampana("error", e.titulo, e.detalle, e.tecnico);
      return;
    }

    const inicio = performance.now();
    pintarEstadoCampana(inicial, `Trabajo ${inicial.id} en la cola (aceptado en ${r.ms} ms).`);
    const resultado = await esperarCampana(config, inicial.id, {
      clave,
      normalizar: normalizarCampana,
      alCambiar: (c) => {
        if (vigente() && c.estado === "pendiente") {
          const s = Math.round((performance.now() - inicio) / 1000);
          pintarEstadoCampana(c, `Trabajo ${c.id ?? inicial.id}: esperando al worker (${s} s).`);
        }
      },
    });
    if (vigente()) mostrarCampana(resultado, inicial.id, Math.round(performance.now() - inicio));
  } catch (e) {
    // Cualquier fallo inesperado deja la pantalla en un estado claro, nunca colgada.
    if (vigente()) {
      pintarEstadoCampana(null, "");
      avisoCampana("error", "No se pudo completar la campaña", "Ocurrió un error inesperado en la página.", String(e?.message ?? e));
    }
  } finally {
    if (vigente()) {
      $("boton-campana").disabled = false;
      $("boton-campana").textContent = "Generar otra vez";
    }
  }
}

function mostrarCampana(resultado, id, msEspera) {
  const c = resultado.campana;
  const segundos = (msEspera / 1000).toFixed(1);

  if (!resultado.final) {
    pintarEstadoCampana(c, `Trabajo ${id}`);
    if (resultado.motivo === "consulta") {
      const e = describirError(resultado.respuesta.estado, resultado.respuesta.cuerpo, "dominio");
      avisoCampana("error", `No se pudo consultar la campaña: ${e.titulo.toLowerCase()}`, e.detalle, e.tecnico);
    } else {
      avisoCampana("fallback", "La campaña sigue en la cola",
        `Pasaron ${segundos} s sin respuesta del worker. Puede estar ocupado o detenido; pulsa «Generar otra vez» más tarde.`,
        "estado pendiente al agotar la espera del navegador");
    }
    return;
  }

  const extra = [c.modelo, c.intentos !== null ? `${c.intentos} intento${c.intentos === 1 ? "" : "s"}` : null, `${segundos} s`]
    .filter(Boolean).join(" · ");
  pintarEstadoCampana(c, `Trabajo ${c.id ?? id} · ${extra}`);

  if (c.estado === "listo") {
    $("aviso-campana").hidden = true;
  } else if (c.degradado) {
    avisoCampana("fallback", "Modo degradado: se muestra un texto de respaldo",
      "El LLM no respondió después de los reintentos. El texto de abajo es genérico, no lo redactó el LLM.",
      c.motivo ? `motivo: ${c.motivo}` : "");
  } else {
    avisoCampana("error", "No se pudo generar la campaña",
      "El worker terminó con error y no dejó texto de respaldo.",
      c.motivo ? `motivo: ${c.motivo}` : "");
  }

  if (c.texto) {
    const bloque = $("texto-campana");
    bloque.textContent = c.texto;
    bloque.classList.toggle("respaldo", c.estado !== "listo");
    bloque.hidden = false;
  }
}

function pintarEstadoCampana(campana, detalle) {
  const { etiqueta, clase } = describirEstadoCampana(campana);
  const chip = $("chip-campana");
  chip.textContent = etiqueta;
  chip.className = `chip ${clase}`;
  $("detalle-campana").textContent = detalle;
}

function avisoCampana(tipo, titulo, detalle, tecnico) {
  $("aviso-campana").hidden = false;
  $("aviso-campana").className = `aviso ${tipo}`;
  $("aviso-campana-titulo").textContent = titulo;
  $("aviso-campana-detalle").textContent = detalle;
  $("aviso-campana-tecnico").textContent = tecnico ?? "";
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
        const claseOrigen = p.origen === "modelo" || p.origen === "fallback" ? p.origen : "desconocido";
        const textoOrigen = p.origen === "modelo" ? "Modelo" : p.origen === "fallback" ? "Plan B" : `(${p.origen})`;
        ul.append(el("li", {},
          el("span", { class: "h-fecha" }, p.fecha ? formatearFecha(p.fecha) : "Sin fecha"),
          el("span", { class: `h-origen ${claseOrigen}` }, textoOrigen),
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

// Si algo falla al arrancar (por ejemplo, un elemento del HTML cambió de id),
// se muestra un aviso visible en vez de quedar la página muerta en silencio.
iniciar().catch((e) => {
  const aviso = document.createElement("div");
  aviso.className = "error-arranque";
  aviso.setAttribute("role", "alert");
  const titulo = document.createElement("p");
  titulo.textContent = "La página no se pudo iniciar. Vuelve a cargarla y revisa que el HTML y el JavaScript sean de la misma versión.";
  const detalle = document.createElement("p");
  detalle.className = "detalle";
  detalle.textContent = `Detalle técnico: ${e && e.message ? e.message : e}`;
  aviso.append(titulo, detalle);
  document.body.append(aviso);
});
