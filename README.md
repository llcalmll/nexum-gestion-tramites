# Nexum · Gestión de trámites de tránsito

Aplicación web para una oficina de trámites de tránsito en Colombia: clientes, vehículos, trámites, licencias, cotizaciones, formatos, envíos y atención por WhatsApp, con un asistente de IA que ayuda a registrar y consultar.

> **Copia de portafolio.** Es el código de la aplicación sin su historial. Teléfonos, correos, placas, documentos, nombres, tarifas y algunos valores numéricos del código se cambiaron por valores de ejemplo, así que no reflejan precios ni tiempos reales. No incluye datos de clientes, formatos oficiales, el modelo del escáner, scripts de prueba ni configuración de acceso. Para ejecutarla hace falta configurar tu propia cuenta de Cloudflare.

## Qué hace
- **Registro de trámites** a partir de fotos y documentos, con revisión antes de guardar.
- **Expediente** por cliente y vehículo, con recordatorios y seguimiento de licencias.
- **Cotizaciones y formatos** que se llenan solos con los datos del trámite.
- **Escáner de documentos** en el navegador con visión por computador.
- **Asistente de IA** para consultar y registrar, también por voz.
- **WhatsApp:** bandeja de conversaciones y clasificación de mensajes.
- **Versión móvil y funcionamiento rápido:** la app trabaja sobre una copia local que se sincroniza con el servidor.
- **Mapa 3D** de la actividad por territorio.

## Tecnología
- **Interfaz:** React, TypeScript, Vite y Three.js.
- **Datos en el navegador:** Dexie (IndexedDB).
- **Servidor:** un solo Cloudflare Worker con D1, R2, Workers AI y Cloudflare Access; Drizzle ORM para la base.
- **Visión en el navegador:** MediaPipe y ONNX Runtime Web.

## Estructura
| Carpeta | Qué hay |
|---|---|
| `src/` | La app: pantallas, componentes y copia local |
| `api/` | El Worker: acceso y rutas |
| `compartido/` | Esquema, tipos y reglas del negocio que usan la app y la API |
| `migraciones/` | SQL de la base |

## Ejecutarla
```bash
npm install
npm run dev
```

Copia `.dev.vars.example` como `.dev.vars` y completa tus claves. Para publicarla, cambia los identificadores y el dominio de `wrangler.jsonc` por los de tu cuenta. Las pantallas de formatos y el escáner necesitan archivos que no vienen en esta copia.
