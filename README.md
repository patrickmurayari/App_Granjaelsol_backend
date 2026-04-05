# Granja El Sol - Backend

Backend para el proyecto Granja El Sol construido con Express y Node.js.

## Instalación

1. Instala las dependencias:
```bash
npm install
```

## Uso

### Modo desarrollo (con nodemon):
```bash
npm run dev
```

### Modo producción:
```bash
npm start
```

El servidor escuchará en `http://localhost:3001` por defecto.

## Rutas disponibles

- **GET `/`** - Verifica que el servidor está funcionando
- **GET `/health`** - Health check del servidor

## Variables de entorno

Configura el archivo `.env`:
```
PORT=3001
NODE_ENV=development
```

## Estructura del proyecto

```
granjaelsolback/
├── server.js          # Archivo principal del servidor
├── package.json       # Dependencias del proyecto
├── .env              # Variables de entorno
├── .gitignore        # Archivos a ignorar en git
└── README.md         # Este archivo
```
