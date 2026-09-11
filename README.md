# SportEdge AI — GitHub + Hostinger

Proyecto Node.js/Express con:
- API-Football / API-SPORTS mediante backend seguro.
- Partidos LIVE y filtros locales (incluido Perú y liga).
- Widgets oficiales API-SPORTS para ligas y partidos.
- Analizador de combinadas, probabilidades y Cash Out demostrativo.
- Noticias deportivas con caché y actualización del servidor cada 60 minutos.
- Caché y presupuesto interno pensados para el plan Free.

## Seguridad de la API key

**Nunca escribas la clave real en `index.html` ni la subas a GitHub.**

El frontend usa `/api/football/` como proxy. El servidor lee la clave desde:

```env
APISPORTS_KEY=TU_CLAVE
```

En Hostinger, agrega `APISPORTS_KEY` en las variables de entorno del proyecto Node.js.

## Ejecutar localmente

1. Instala Node.js LTS.
2. Copia `.env.example` como `.env`.
3. Pega en `.env` una API key nueva.
4. Ejecuta:

```bash
npm install
npm start
```

5. Abre `http://localhost:8080`.

## GitHub

Sube estos archivos, pero **NO** subas `.env` ni `node_modules/`. `.gitignore` ya los excluye.

## Widgets oficiales

El proyecto carga Widgets API-SPORTS v3 y configura:
- `data-sport="football"`
- `data-lang="es"`
- `data-theme="white"`
- `data-refresh="600"`
- `data-url-football="https://TU-DOMINIO/api/football/"` de forma dinámica.

La clave queda vacía en el HTML porque el backend la añade al llamar a API-Football.
