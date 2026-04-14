# 🥩 Granja El Sol — Backend

> API RESTful modular para la gestión de una carnicería y almacén. Maneja inventario, pedidos y cierres de caja con lógica de negocio robusta y persistencia en Supabase (PostgreSQL).

---

## 📋 Descripción

El backend de **Granja El Sol** expone una API REST que soporta toda la operación diaria del negocio: desde el catálogo de productos en tiempo real hasta el cierre de caja inteligente que calcula automáticamente la diferencia entre el efectivo teórico y el real.

Diseñado con una **arquitectura modular** (controllers → routes → app), prioriza la separación de responsabilidades, la mantenibilidad y la escalabilidad. Desplegado como función serverless en Vercel, con soporte para desarrollo local tradicional.

---

## 🛠️ Tecnologías

| Tecnología | Uso |
|---|---|
| **Node.js** | Runtime de ejecución |
| **Express 4** | Framework web minimalista |
| **PostgreSQL (Supabase)** | Base de datos relacional con columna calculada |
| **pg (node-postgres)** | Driver de PostgreSQL con connection pooling |
| **CORS** | Middleware de seguridad cross-origin |
| **Dotenv** | Gestión de variables de entorno |
| **Vercel Serverless** | Despliegue como función serverless |

---

## ⭐ Características Principales

### 📦 Gestión de Productos
- **GET `/api/productos`** — Listado con filtro opcional por categoría (`?categoria=Carnes`)
- **POST `/api/productos`** — Creación con validación de nombre obligatorio
- **PUT `/api/productos/:id`** — Actualización dinámica de campos (solo los enviados)

### 🛒 Gestión de Pedidos
- **POST `/api/pedidos`** — Registro con items como JSONB, total estimado y estado inicial "pendiente"
- **GET `/api/pedidos`** — Listado ordenado por fecha descendente
- **PUT `/api/pedidos/:id`** — Actualización de estado con validación (pendiente → preparando → entregado)

### 💰 Cierre de Caja Inteligente
- **GET `/api/cierres`** — Historial configurable (`?limite=7`) con diferencia calculada por la DB
- **POST `/api/cierres`** — Upsert automático: si ya existe un cierre para hoy, lo actualiza; si no, lo crea
- **PUT `/api/cierres/:id`** — Edición por ID con recálculo automático de diferencia

> **Diferencia de caja**: La columna `diferencia_caja` es una **generated column** en PostgreSQL que se calcula automáticamente como:
> `efectivo_final - fondo_inicial - (venta_total_balanza - venta_posnet - venta_transferencias - gastos_del_dia)`
> El backend nunca la inserta ni actualiza — la DB la calcula al vuelo, eliminando inconsistencias.

### 🔒 Seguridad
- **CORS configurado** con lista blanca de orígenes permitidos (producción + desarrollo)
- **Validación de entrada** en todos los endpoints (campos obligatorios, tipos numéricos, estados válidos)
- **SQL parametrizado** con `$1, $2...` para prevenir inyección SQL
- **Error handling centralizado** con middleware de Express

---

## 📁 Estructura del Proyecto

```
backend/
├── index.js                          # Punto de entrada (dotenv + listen / export serverless)
├── vercel.json                       # Configuración de despliegue Vercel
├── package.json                      # main: "index.js"
└── src/
    ├── app.js                        # Express app + middlewares + rutas + error handlers
    ├── config/
    │   └── db.js                     # Pool de PostgreSQL (Supabase) con SSL
    ├── controllers/
    │   ├── productosController.js    # Lógica de productos (GET, POST, PUT)
    │   ├── pedidosController.js      # Lógica de pedidos (GET, POST, PUT)
    │   └── cierreCajaController.js   # Lógica de cierres (GET, POST, PUT + upsert)
    └── routes/
        ├── productosRoutes.js        # /api/productos
        ├── pedidosRoutes.js          # /api/pedidos
        └── cierreCajaRoutes.js       # /api/cierres
```

---

## 🚀 Instalación

```bash
# Clonar el repositorio
git clone https://github.com/patrickmurayari/App_Granjaelsol.git
cd App_Granjaelsol/backend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores:
# DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
# PORT=3001

# Iniciar servidor de desarrollo (con nodemon)
npm run dev

# Iniciar servidor de producción
npm start
```

El servidor escuchará en `http://localhost:3001` por defecto.

---

## 📡 API Endpoints

### Productos
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/productos` | Listar productos (opcional: `?categoria=Carnes`) |
| `POST` | `/api/productos` | Crear producto |
| `PUT` | `/api/productos/:id` | Actualizar producto |

### Pedidos
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/pedidos` | Listar pedidos (ordenados por fecha) |
| `POST` | `/api/pedidos` | Registrar pedido |
| `PUT` | `/api/pedidos/:id` | Actualizar estado de pedido |

### Cierres de Caja
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/cierres` | Historial de cierres (opcional: `?limite=7`) |
| `POST` | `/api/cierres` | Crear/actualizar cierre del día (upsert) |
| `PUT` | `/api/cierres/:id` | Actualizar cierre por ID |

### Utilidad
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Verificación de estado del servidor |
| `GET` | `/health` | Health check con información del puerto |

---

## 🌐 Despliegue en Vercel

El backend está configurado como **función serverless**:

1. `index.js` exporta la instancia de `app` para Vercel
2. `app.listen()` solo se ejecuta en desarrollo local (detecta `VERCEL` env var)
3. `vercel.json` enruta todas las peticiones a `index.js`

```bash
# Desplegar a producción
vercel --prod
```

**URL de producción**: `https://app-granjaelsol-backend.vercel.app`

---

## 🏗️ Decisiones Técnicas

- **Arquitectura modular**: separación estricta entre routes (definen endpoints) y controllers (lógica de negocio), facilitando testing y mantenimiento
- **Generated column para diferencia_caja**: delegar el cálculo a PostgreSQL garantiza consistencia — nunca hay discrepancia entre lo que el backend envía y lo que la DB almacena
- **Upsert en POST /cierres**: si el usuario guarda múltiples veces el cierre del día, se actualiza en lugar de duplicar
- **CORS con whitelist**: en lugar de `cors()` abierto, se valida cada origen contra una lista explícita, incluyendo previews de Vercel
- **SQL parametrizado**: todas las consultas usan `$n` placeholders, previniendo inyección SQL incluso en campos dinámicos (UPDATE parcial de productos)

---

*Construido con 💪 para que el comercio de barrio tenga herramientas de nivel enterprise.*
