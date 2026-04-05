const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta básica para verificar que el servidor está escuchando
app.get('/', (req, res) => {
  res.status(200).json({
    mensaje: '¡Servidor de Granja El Sol está funcionando correctamente!',
    estado: 'activo',
    timestamp: new Date().toISOString()
  });
});

// Ruta de salud (health check)
app.get('/health', (req, res) => {
  res.status(200).json({
    estado: 'ok',
    servidor: 'Granja El Sol Backend',
    puerto: PORT
  });
});

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    ruta: req.originalUrl
  });
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Error interno del servidor',
    mensaje: err.message
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Granja El Sol escuchando en puerto ${PORT}`);
  console.log(`📍 Accede a: http://localhost:${PORT}`);
});
