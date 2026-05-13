# ARMHEL + INO — Backend

Backend modular para **Vercel Serverless Functions** + **Firestore** que unifica la tienda ARMHEL y el panel operativo INO (Industrial Network Operation).

## Estructura

```
api/
  products/
    index.js          GET (lista) · POST (crear)
    [id].js           GET · PATCH · DELETE
  quotations/
    index.js          GET (lista) · POST (crear)
    [id].js           GET · PATCH · POST?action=pdf · DELETE
  activities/
    index.js          GET (feed de eventos)
  webhooks/
    mercadopago.js    POST (webhook de pagos)
  ia/
    suggestions.js    POST (asesor técnico IA)
firestore/
  schema.js           Definición del modelo de datos
  rules.firestore     Reglas de seguridad
  indexes.json        Índices compuestos
lib/
  firebase.js         Admin SDK, helpers CORS, auth, events, automations
server.dev.js         Servidor HTTP local (simula Vercel, solo para desarrollo)
.env.example          Variables de entorno necesarias
```

## Variables de entorno

Copiar `.env.example` y configurar en Vercel → Settings → Environment Variables:

| Variable | Descripción |
|---|---|
| `FIREBASE_PROJECT_ID` | ID del proyecto Firebase |
| `FIREBASE_CLIENT_EMAIL` | Email de la cuenta de servicio |
| `FIREBASE_PRIVATE_KEY` | Clave privada (con `\n` literales) |
| `DEFAULT_ORG_ID` | Org por defecto cuando no se envía `X-Org-Id` |
| `STORE_ORIGIN` | Dominio del frontend para CORS |
| `MP_ACCESS_TOKEN` | Token de acceso Mercado Pago |
| `MP_WEBHOOK_SECRET` | Secreto para verificar firma de webhooks MP |
| `ANTHROPIC_API_KEY` | API key de Anthropic (asesor IA) |

## Activación

```bash
# 1. Instalar dependencias
npm install

# 2. Verificar sintaxis de todos los módulos
npm run check

# 3. Desarrollo local (sin Vercel CLI)
cp .env.example .env   # completar con valores reales
node server.dev.js

# 4. Deploy a Vercel
vercel deploy --prod
```

## Firestore

```bash
# Publicar reglas
firebase deploy --only firestore:rules

# Crear índices
firebase deploy --only firestore:indexes
```

## API — Referencia rápida

### Autenticación
Todos los endpoints protegidos requieren:
- Header `Authorization: Bearer <firebase-id-token>`
- Header `X-Org-Id: <orgId>` (o se usa `DEFAULT_ORG_ID`)

### Productos
```
GET    /api/products              ?store=true|catalog=true|category=|search=|cursor=|limit=
POST   /api/products              { sku, name, category, costPrice, salePrice, ... }
GET    /api/products/:id
PATCH  /api/products/:id          { campos a actualizar }
DELETE /api/products/:id          (requiere rol admin)
```

### Cotizaciones
```
GET    /api/quotations            ?status=|clientId=|assignedTo=|cursor=|limit=
POST   /api/quotations            { clientName, groups, currency?, exchangeRate?, ... }
GET    /api/quotations/:id
PATCH  /api/quotations/:id        { status?, groups?, _statusNote?, ... }
POST   /api/quotations/:id?action=pdf  { pdfUrl? }
DELETE /api/quotations/:id        (solo estado draft, requiere rol admin)
```

### Actividades
```
GET    /api/activities            ?event=|entityType=|tone=|since=|limit=
```

### Webhook Mercado Pago
```
POST   /api/webhooks/mercadopago  (payload de MP, verifica firma HMAC-SHA256)
```

### Asesor IA
```
POST   /api/ia/suggestions        { mensaje, contexto? }
```

## Modelo de datos

Todas las entidades operativas viven bajo:
```
organizations/{orgId}/products|quotations|orders|activities|automations|tasks|...
```

La tienda pública lee productos con `visibleInStore: true` sin autenticación.  
INO opera contra las mismas entidades con auth, roles, activities y automations.

## Roles

| Rol | Permisos |
|---|---|
| `viewer` | Solo lectura |
| `operator` | Crear y editar productos, cotizaciones |
| `admin` | + Eliminar, aprobar, acceso completo |
| `owner` | Control total de la organización |
