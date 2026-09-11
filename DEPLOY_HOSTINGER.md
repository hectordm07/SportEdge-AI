# Despliegue rápido: GitHub → Hostinger → SportEdgeAI.com

## 1. GitHub

Crea un repositorio llamado `sportedge-ai` y sube los archivos de esta carpeta.

No subas:
- `.env`
- `node_modules/`

## 2. Hostinger

En hPanel crea una aplicación Node.js compatible con tu plan y conecta el repositorio.

Configuración:

- Install command: `npm install`
- Start command: `npm start`
- Node: 18 o superior

## 3. Variable secreta

En las variables de entorno de la aplicación añade:

- Nombre: `APISPORTS_KEY`
- Valor: tu nueva API key de API-Football

No escribas la clave en `index.html`, `server.js`, `README.md` ni GitHub.

## 4. Dominio

Conecta `SportEdgeAI.com` a la aplicación desde hPanel y habilita SSL.

## 5. Actualizaciones futuras

El flujo esperado es:

GitHub → despliegue Hostinger → SportEdgeAI.com

Así no tendrás que subir archivos manualmente en cada cambio si dejas activo el despliegue desde el repositorio.
