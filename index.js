require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const app = require('./src/app');
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Servidor de Granja El Sol escuchando en puerto ${PORT}`);
  console.log(`🔗 Accede a: http://localhost:${PORT}`);
});
