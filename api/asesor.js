module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const { pregunta, producto } = req.body ?? {};
  if (!pregunta) return res.status(400).json({ error: "El campo pregunta es obligatorio" });

  const systemPrompt = `Sos el asesor técnico de ARMHEL Ferretería en Montevideo. Respondé en español rioplatense, máximo 3 oraciones.
${producto ? `Producto: ${producto.nombre} - $${producto.precio}` : ""}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: pregunta }],
      }),
    });

    const data = await response.json();
    const respuesta = data.content?.[0]?.text ?? "Sin respuesta.";
    return res.status(200).json({ respuesta });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
