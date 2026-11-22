# nexus-front

Front del recomendador de productos de **Nexus Retail SpA**. Evaluación Parcial 2 de ITY1102, Arquitectura de Sistemas de Inteligencia Artificial.

Es una página estática (HTML, CSS y JavaScript sin frameworks ni dependencias) servida por Nginx en el puerto 80 de la red interna. No publica puertos: el gateway reenvía `/` a `front:80` y el navegador solo habla con `http://localhost:8080`.

## Qué hace

- **Flujo principal:** el usuario escribe el código de un cliente, elige cuántos productos quiere (4 a 8) y ve las recomendaciones ordenadas como etiquetas de precio en una góndola. Debajo aparecen el origen (modelo o plan B), la versión del modelo, el tiempo de respuesta, el id con que se guardó la predicción y la fecha.
- **Plan B visible:** si la IA responde `origen: "fallback"`, las etiquetas pasan de amarillo a blanco y se muestra el `motivo`.
- **Estado de los servicios:** cada 5 segundos consulta `/health` del gateway, del dominio y de la IA, y lo muestra arriba a la derecha: `en línea`, `sin modelo` (respuesta 503), `lento` (504), `caído` (502) o `sin respuesta` (cualquier otro código, o sin respuesta HTTP). Sirve para la pregunta del IE4: al detener una réplica o la IA, se ve en la pantalla. Ojo con la etiqueta `sin modelo`: se aplica al 503 de los tres servicios, y en el dominio el 503 significa que la base de datos no responde.
- **Errores del gateway traducidos:** el 502 `servicio_no_disponible`, el 504 `tiempo_de_espera_agotado`, el 404 `ruta_no_encontrada`, el 503 y el 422 se muestran con un mensaje claro y el detalle técnico (código y servicio).
- **Datos del cliente (opcional):** si el dominio los entrega, muestra sus compras anteriores y sus recomendaciones anteriores. Si esas rutas no existen todavía, el panel dice "No disponible" y el flujo principal sigue funcionando.
- Se puede abrir con `http://localhost:8080/?cliente=U100406` para que haga la petición al cargar.
- **Campaña con LLM (EP3):** ver la sección siguiente.

## Campaña con LLM (EP3)

Después de recomendar productos aparece la sección **«Campaña para este cliente»** con el botón **Generar campaña**. El navegador **nunca llama al LLM**: el texto lo arma un worker en segundo plano a partir de datos anonimizados (tarea 1, en `nexus-dominio`).

```text
Generar campaña ──POST /api/dominio/campanas/{usuario}──▶ dominio ──▶ RabbitMQ ──▶ worker ──▶ LLM
        │                  202 {"id": 7, "estado": "pendiente"}                 │
        └── cada 2 s ──GET /api/dominio/campanas/7──▶ dominio ◀── PostgreSQL (campanas) ◀┘
```

| Estado que devuelve el dominio | Qué muestra el front |
|---|---|
| `pendiente` | Etiqueta amarilla **Pendiente…** y los segundos que lleva en la cola |
| `listo` | Etiqueta verde **Lista** y el texto generado, con modelo, intentos y tiempo |
| `error` **con** `texto` (modo degradado) | Etiqueta naranja **Texto de respaldo**, aviso «Modo degradado» con el `motivo_error` y el texto de respaldo marcado como genérico |
| `error` sin `texto` | Etiqueta roja **Error** y el `motivo_error` |

La pantalla **nunca queda colgada**:

- Si el worker no termina en 90 s, se deja de consultar y se avisa «La campaña sigue en la cola»; el botón vuelve a quedar disponible.
- Un 429 o 5xx al consultar se reintenta en la siguiente vuelta; un 401, 404 o 422 corta de inmediato con el mensaje del error.
- Si el `POST` falla (por ejemplo, 403 si el cliente no autorizó campañas de marketing, o 502 si el dominio está caído), se muestra el error y **la vitrina de recomendaciones no se toca**.
- Si se cambia de cliente mientras una campaña espera, la respuesta vieja se descarta.

Campos que lee (los de la tabla `campanas`): `id`, `estado`, `texto`, `motivo_error`, `modelo_llm`, `intentos`, `creado_en`, `actualizado_en`. Para el id del `202` acepta también `campana_id` o `trabajo_id`, y el estado `degradado` se trata como `error` con texto.

### Clave de API (tarea 2)

Abajo en la página hay un campo **Clave de API**. Si se escribe, el front la envía en la cabecera `X-API-Key` en la predicción y en las campañas; si está vacío, no envía la cabecera (así funciona igual antes de que la tarea 2 esté fusionada). La clave queda solo en `sessionStorage` de esa pestaña: nunca va en el código, en la imagen ni en `config.json`. Un `401` muestra «Falta la clave de API o no es válida» y un `429` «Demasiadas peticiones seguidas».

## Rutas que usa (todas pasan por el gateway)

| Método | Ruta | ¿Obligatoria? | Para qué |
|---|---|---|---|
| GET | `/config.json` | sí (la sirve este mismo contenedor) | Lee la ruta del flujo principal |
| GET | `/health` | no | Estado del gateway |
| GET | `/api/dominio/health` | no | Estado del dominio |
| GET | `/api/ia/health` | no | Estado de la IA |
| **POST** | **`/api/dominio/predicciones`** | **sí** | **Flujo principal** |
| GET | `/api/dominio/usuarios?limite=6` | no | Botones con clientes de ejemplo |
| GET | `/api/dominio/usuarios/{id}/compras?limite=8` | no | Panel "Lo que ya compró" |
| GET | `/api/dominio/predicciones?usuario_id={id}&limite=5` | no | Panel "Recomendaciones anteriores" |
| POST | `/api/dominio/campanas/{usuario}` | no | Pide una campaña con LLM (responde 202) |
| GET | `/api/dominio/campanas/{id}` | no | Estado de la campaña: `pendiente`, `listo`, `degradado` o `error` |

## Contrato con el microservicio de dominio

El front no llama a la IA para el flujo principal: llama al **dominio**, que llama a `ia:8000/predict`, guarda la predicción en la base (entrada, resultado, versión del modelo y fecha, como pide el enunciado) y devuelve el resultado. Si el front llamara directo a la IA, la predicción no quedaría guardada.

**`POST /predicciones`** (en el gateway: `/api/dominio/predicciones`)

Entrada (la misma que recibe la IA):

```json
{ "usuario_id": "U100406", "k": 8 }
```

Respuesta esperada: la respuesta de la IA más los campos que agrega el dominio (`id`, `fecha`, `version_modelo`, `atendido_por`, `ia_ms`, `total_ms`):

```json
{
  "id": 42,
  "fecha": "2026-10-14T23:15:03Z",
  "version_modelo": "hgb-2026.10-e580c69",
  "usuario_id": "U100406",
  "origen": "modelo",
  "motivo": null,
  "recomendaciones": [
    { "puesto": 1, "sku": "NX-10448", "categoria": "redes", "marca": "Dell", "precio_lista": 10857.0, "puntaje": 4.8107 }
  ]
}
```

El front también acepta la predicción envuelta (`{"id": 42, "prediccion": {...}}`) y los nombres `modelo_version` o `version` en vez de `version_modelo`. La interfaz mantiene la ruta compatible `/api/dominio/predicciones` (201); EP3 expone además `/api/predict` (200) con la misma respuesta persistida. Si la IA no responde, el dominio entrega `origen: "fallback"` y su lista de más vendidos. El **503** aparece cuando la base de datos del dominio no responde, y el front muestra su `detail`.

**Rutas opcionales:**

- `GET /usuarios?limite=6` devuelve `[{"usuario_id": "U100649", "region": "antofagasta"}, ...]`
- `GET /usuarios/{id}/compras?limite=8` devuelve `[{"sku": "...", "categoria": "...", "marca": "...", "fecha": "2025-10-10T...", "cantidad": 1}, ...]`
- `GET /predicciones?usuario_id=U100406&limite=5` devuelve una lista de predicciones con la misma forma que el POST

En las tres se acepta también un objeto `{"items": [...]}`.

## Despliegue en Vercel

En Vercel no hay gateway: Vercel solo sirve `public/`. Por eso `vercel.json` reenvía (rewrites) `/api/*`, `/health` y `/config.json` al gateway de EC2 (`https://52-1-100-14.sslip.io`), y el navegador sigue usando rutas relativas, igual que detrás del gateway. Sin esos rewrites, el `POST` de la predicción llega al propio Vercel y responde **405 Not Allowed**.

- En el proyecto de Vercel, **Root Directory** debe quedar vacío (raíz del repo): si apunta a `public/`, Vercel no lee `vercel.json`.
- Si cambia la IP elástica de EC2, hay que actualizar las tres rutas de `vercel.json`.

## Configuración

| Variable | Valor por defecto | Para qué |
|---|---|---|
| `RUTA_PREDICCION` | `/api/dominio/predicciones` | Ruta del flujo principal. Para probar el front mientras el dominio no existe se puede usar `/api/ia/predict` (la predicción no se guarda). |
| `RUTA_CAMPANAS` | `/api/dominio/campanas` | Base de las rutas de campañas. El gateway quita `/api/dominio` y el dominio atiende `POST /campanas/{usuario}` y `GET /campanas/{id}`. |

Nginx genera `/config.json` al arrancar a partir de estas variables (plantilla en `nginx/default.conf.template`), así que se cambia en el `compose.yaml` sin reconstruir la imagen. El `compose.yaml` funciona sin definirla.

### Caché de CSS y JS

`index.html` carga los archivos con `?v=<versión>` (la misma que `package.json`). Nginx los sirve con `expires 1h`; al subir el `?v=` el navegador descarga la nueva versión aunque el caché esté vigente. **Al publicar una corrección en JS o CSS: subir la `version` de `package.json`, los dos `?v=` de `index.html` y los `?v=` de los `import` de `public/js/app.js`.** Los imports entre módulos también llevan versión: si no, el navegador puede combinar un `app.js` nuevo con un `formato.js` viejo de su caché y la página no arranca. `tests/version.test.mjs` falla si alguna versión no coincide.

## Servicio en el `compose.yaml` de la defensa

```yaml
  front:
    image: ghcr.io/jaimebarrales/nexus-front:ep2
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1/health"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s
    cpus: "0.25"
    mem_limit: 32m   # medir con docker stats y justificar en el capítulo 7.2
```

Sin `build:`, sin `ports:` y sin bind mounts, como pide la sección 2.3.

## Imagen

- Base: `nginx:1.30.5-alpine`, la misma del gateway. Se eligió porque el front es estático: no necesita Node ni Python en tiempo de ejecución, la imagen pesa unos 20 MB y usa la misma versión de Nginx que el gateway.
- La fuente Archivo (licencia SIL OFL, en `public/fuentes/`) va dentro de la imagen, para que la página se vea igual sin internet.
- Cabeceras de seguridad: `Content-Security-Policy` (solo contenido del mismo origen), `X-Content-Type-Options`, `Referrer-Policy` y `X-Frame-Options`.

## Pruebas

```bash
node --test tests/*.test.mjs        # lógica: formato, validación, errores del gateway, llamadas HTTP, campañas y clave
sh tests/humo.sh nexus-front:prueba # imagen: healthy, rutas, config.json, CSP (requiere Docker)
```

## Pipeline (`.github/workflows/ci.yml`)

| Evento | Qué hace |
|---|---|
| Pull request hacia `dev` o `main` | Tests, build y prueba de humo, sin publicar |
| Push a `main` | Lo mismo y publica `ghcr.io/jaimebarrales/nexus-front` con `sha-<commit>` y `latest` |
| Tag `ep2` sobre `main` | Publica la misma imagen con el tag `ep2` |

`docker/metadata-action` agrega la etiqueta `org.opencontainers.image.revision`. Para ver qué commit está corriendo:

```bash
docker image inspect ghcr.io/jaimebarrales/nexus-front:ep2 --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

Después de la primera publicación, el paquete queda privado: hay que hacerlo público en GitHub, en Packages, `nexus-front`, Package settings, Change visibility.

## Flujo de trabajo (gitflow mínimo)

- `main`: lo que se entrega. Solo por pull request desde `dev`.
- `dev`: integración. Solo por pull request desde una rama `feat/`.
- `feat/<descripcion>`: una funcionalidad a la vez, por ejemplo `feat/front-formulario`, `feat/front-estado-servicios` o `feat/front-pipeline`.
