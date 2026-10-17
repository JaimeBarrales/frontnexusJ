# Front de Nexus Retail: HTML, CSS y JavaScript estáticos servidos por Nginx.
# Misma imagen base que el gateway: una sola versión de Nginx en todo el sistema.
FROM nginx:1.30.5-alpine

# Ruta del flujo principal. El valor por defecto pasa por el dominio, que guarda la predicción.
ENV RUTA_PREDICCION=/api/dominio/predicciones

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1/health"]
