# nexus-front

Front del recomendador de productos de **Nexus Retail SpA**. Evaluación Parcial 2 de ITY1102, Arquitectura de Sistemas de Inteligencia Artificial.

Es una página estática (HTML, CSS y JavaScript sin frameworks ni dependencias) servida por Nginx en el puerto 80 de la red interna. No publica puertos: el gateway reenvía `/` a `front:80` y el navegador solo habla con `http://localhost:8080`.

## Qué hace

- **Flujo principal:** el usuario escribe el código de un cliente, elige cuántos productos quiere (4 a 8) y ve las recomendaciones ordenadas como etiquetas de precio en una góndola. Debajo aparecen el origen (modelo o plan B), la versión del modelo, el tiempo de respuesta, el id con que se guardó la predicción y la fecha.
- **Plan B visible:** si la IA responde `origen: "fallback"`, las etiquetas pasan de amarillo a blanco y se muestra el `motivo`.
- **Estado de los servicios:** cada 5 segundos consulta `/health` del gateway, del dominio y de la IA, y lo muestra arriba a la derecha (en línea, caído, sin modelo o lento). Sirve para la pregunta del IE4: al detener una réplica o la IA, se ve en la pantalla.
- **Errores del gateway traducidos:** el 502 `servicio_no_disponible`, el 504 `tiempo_de_espera_agotado`, el 404 `ruta_no_encontrada`, el 503 y el 422 se muestran con un mensaje claro y el detalle técnico (código y servicio).
- **Datos del cliente (opcional):** si el dominio los entrega, muestra sus compras anteriores y sus recomendaciones anteriores. Si esas rutas no existen todavía, el panel dice "No disponible" y el flujo principal sigue funcionando.
- Se puede abrir con `http://localhost:8080/?cliente=U100406` para que haga la petición al cargar.

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

## Contrato con el microservicio de dominio

El front no llama a la IA para el flujo principal: llama al **dominio**, que llama a `ia:8000/predict`, guarda la predicción en la base (entrada, resultado, versión del modelo y fecha, como pide el enunciado) y devuelve el resultado. Si el front llamara directo a la IA, la predicción no quedaría guardada.

**`POST /predicciones`** (en el gateway: `/api/dominio/predicciones`)

Entrada (la misma que recibe la IA):

```json
{ "usuario_id": "U100406", "k": 8 }
```

Respuesta esperada: la respuesta de la IA más tres campos que agrega el dominio (`id`, `fecha`, `version_modelo`):

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

El front también acepta la predicción envuelta (`{"id": 42, "prediccion": {...}}`) y los nombres `modelo_version` o `version` en vez de `version_modelo`. Si la IA no responde, el dominio debería devolver un **503** con `{"detail": "El servicio de IA no responde"}`: el front muestra ese texto.

**Rutas opcionales:**

- `GET /usuarios?limite=6` devuelve `[{"usuario_id": "U100649", "region": "antofagasta"}, ...]`
- `GET /usuarios/{id}/compras?limite=8` devuelve `[{"sku": "...", "categoria": "...", "marca": "...", "fecha": "2025-10-10T...", "cantidad": 1}, ...]`
- `GET /predicciones?usuario_id=U100406&limite=5` devuelve una lista de predicciones con la misma forma que el POST

En las tres se acepta también un objeto `{"items": [...]}`.

## Configuración

| Variable | Valor por defecto | Para qué |
|---|---|---|
| `RUTA_PREDICCION` | `/api/dominio/predicciones` | Ruta del flujo principal. Para probar el front mientras el dominio no existe se puede usar `/api/ia/predict` (la predicción no se guarda). |

Nginx genera `/config.json` al arrancar a partir de esta variable (plantilla en `nginx/default.conf.template`), así que se cambia en el `compose.yaml` sin reconstruir la imagen. El `compose.yaml` funciona sin definirla.

## Servicio en el `compose.yaml` de la defensa

```yaml
  front:
    image: ghcr.io/<cuenta>/nexus-front:ep2
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
node --test tests/*.test.mjs        # lógica: formato, validación, errores del gateway, llamadas HTTP
sh tests/humo.sh nexus-front:prueba # imagen: healthy, rutas, config.json, CSP (requiere Docker)
```

## Pipeline (`.github/workflows/ci.yml`)

| Evento | Qué hace |
|---|---|
| Pull request hacia `dev` o `main` | Tests, build y prueba de humo, sin publicar |
| Push a `main` | Lo mismo y publica `ghcr.io/<cuenta>/nexus-front` con `sha-<commit>` y `latest` |
| Tag `ep2` sobre `main` | Publica la misma imagen con el tag `ep2` |

`docker/metadata-action` agrega la etiqueta `org.opencontainers.image.revision`. Para ver qué commit está corriendo:

```bash
docker image inspect ghcr.io/<cuenta>/nexus-front:ep2 --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

Después de la primera publicación, el paquete queda privado: hay que hacerlo público en GitHub, en Packages, `nexus-front`, Package settings, Change visibility.

## Flujo de trabajo (gitflow mínimo)

- `main`: lo que se entrega. Solo por pull request desde `dev`.
- `dev`: integración. Solo por pull request desde una rama `feat/`.
- `feat/<descripcion>`: una funcionalidad a la vez, por ejemplo `feat/front-formulario`, `feat/front-estado-servicios` o `feat/front-pipeline`.
