require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const app = require('./src/app');

// Para Vercel: exportar como handler serverless
module.exports = app;

// Para desarrollo local: iniciar servidor solo si no estamos en Vercel
if (process.env.VERCEL !== '1' && !process.env.VERCEL_URL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`✅ Servidor de Granja El Sol escuchando en puerto ${PORT}`);
    console.log(`🔗 Accede a: http://localhost:${PORT}`);
  });
}
