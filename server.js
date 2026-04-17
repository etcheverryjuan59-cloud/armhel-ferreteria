const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());


// 🧪 Ruta base
app.get("/", (req, res) => {
  res.send("Servidor funcionando");
});


// 🤖 Ruta del asesor IA (CLAVE)
app.post("/ia", (req, res) => {
  try {
    const { mensaje } = req.body;

    console.log("Mensaje recibido:", mensaje);

    res.json({
      respuesta: "Asesor activo: " + mensaje
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Error en IA");
  }
});


const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});