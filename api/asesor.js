// api/asesor.js  ← Vercel Serverless Function
// Ruta: /api/asesor
// Variables de entorno requeridas: ANTHROPIC_API_KEY

export default async function handler(req, res) {
  // CORS — permitir llamadas desde tu dominio Vercel y localhost
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { pregunta, producto } = req.body ?? {};

  if (!pregunta) {
    return res.status(400).json({ error: "El campo 'pregunta' es obligatorio" });
  }

  const systemPrompt = `Sos el asesor técnico de ARMHEL Ferretería, una ferretería en Montevideo, Uruguay.
Tu trabajo es ayudar a los clientes a elegir el producto correcto, entender sus características y resolver dudas técnicas.
Respondé siempre en español rioplatense (vos, etc.), de manera clara, amigable y profesional.
Sé conciso: máximo 3-4 oraciones por respuesta.
Si el cliente pregunta algo que no tiene que ver con ferretería o el producto, redirigílo amablemente.
${producto ? `El cliente está viendo este producto:\nNombre: ${producto.nombre}\nDescripción: ${producto.descripcion ?? "Sin descripción"}\nPrecio: $${producto.precio}\nStock: ${producto.stock > 0 ? "Disponible" : "Sin stock"}` : ""}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // rápido y económico para chat
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: pregunta }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Error Anthropic:", err);
      return res.status(502).json({ error: "Error al consultar la IA", detalle: err });
    }

    const data = await response.json();
    const respuesta = data.content?.[0]?.text ?? "No pude generar una respuesta.";

    return res.status(200).json({ respuesta });
  } catch (error) {
    console.error("Error interno:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
