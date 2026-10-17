#!/usr/bin/env sh
# Prueba de humo de la imagen del front. La ejecuta el workflow después de construir la imagen.
# Uso: sh tests/humo.sh <imagen>
set -eu

IMAGEN="${1:?indica la imagen, por ejemplo nexus-front:prueba}"
NOMBRE="front-humo-$$"
RED="red-humo-$$"
FALLAS=0

limpiar() {
  docker rm -f "$NOMBRE" >/dev/null 2>&1 || true
  docker network rm "$RED" >/dev/null 2>&1 || true
}
trap limpiar EXIT

# Sin "-p": igual que en el compose, el front no publica puertos. Se prueba desde otro contenedor de la red.
docker network create "$RED" >/dev/null
docker run -d --name "$NOMBRE" --network "$RED" --network-alias front "$IMAGEN" >/dev/null

echo "Esperando a que el contenedor quede healthy..."
for _ in $(seq 1 30); do
  estado=$(docker inspect -f '{{.State.Health.Status}}' "$NOMBRE")
  [ "$estado" = "healthy" ] && break
  sleep 1
done
echo "  estado: $estado"
[ "$estado" = "healthy" ] || { docker logs "$NOMBRE"; exit 1; }

revisar() {  # revisar <nombre> <ruta> <texto esperado en la respuesta>
  salida=$(docker run --rm --network "$RED" "$IMAGEN" wget -q -O - "http://front$2" 2>&1 || true)
  if printf '%s' "$salida" | grep -q -- "$3"; then
    echo "  [OK]    $1"
  else
    echo "  [FALLA] $1 (no contiene: $3)"
    FALLAS=$((FALLAS + 1))
  fi
}

revisar "GET / entrega la página"                    "/"                    "Recomendar productos"
revisar "GET /health responde JSON"                  "/health"              '"service":"front"'
revisar "GET /config.json trae la ruta por defecto"  "/config.json"         '/api/dominio/predicciones'
revisar "GET /js/app.js existe"                      "/js/app.js"           "pedirPrediccion"
revisar "GET /css/estilos.css existe"                "/css/estilos.css"     "gondola"
revisar "Una ruta desconocida vuelve al index"       "/cualquier/cosa"      "Recomendar productos"

cabeceras=$(docker run --rm --network "$RED" "$IMAGEN" wget -q -S -O /dev/null "http://front/" 2>&1 || true)
if printf '%s' "$cabeceras" | grep -qi "content-security-policy"; then
  echo "  [OK]    La página trae Content-Security-Policy"
else
  echo "  [FALLA] Falta la cabecera Content-Security-Policy"; FALLAS=$((FALLAS + 1))
fi

# La ruta se cambia con una variable de entorno, sin reconstruir la imagen.
docker rm -f "$NOMBRE" >/dev/null
docker run -d --name "$NOMBRE" --network "$RED" --network-alias front -e RUTA_PREDICCION=/api/ia/predict "$IMAGEN" >/dev/null
sleep 2
revisar "RUTA_PREDICCION cambia config.json" "/config.json" '/api/ia/predict'

if [ "$FALLAS" -gt 0 ]; then
  echo "Fallaron $FALLAS pruebas"; exit 1
fi
echo "Todas las pruebas de humo pasaron"
