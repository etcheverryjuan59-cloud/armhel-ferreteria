const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());


// 🧪 Ruta base
app.get("/", (req, res) => {
  res.send("Servidor funcionando");
});


// 🤖 Ruta IA
app.post("/ia", async (req, res) => {
  try {
    const { mensaje } = req.body;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Sos asesor técnico de ferretería. Responde claro y corto:\n\n${mensaje}`
          }
        ]
      })
    });

    const data = await response.json();

    res.json({
      respuesta: data.content?.[0]?.text || "Sin respuesta"
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      respuesta: "Error en IA"
    });
  }
});


// 🚀 PORT
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
