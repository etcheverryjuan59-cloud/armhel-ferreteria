/**
 * POST /api/ia/suggestions
 * Body: { mensaje: string, contexto?: string }
 * Asesor técnico de ferretería potenciado por Claude.
 */

import { apiError, apiOk, setCors } from '../../lib/firebase.js';

export default async function handler(req, res) {
  if (setCors(req, res, 'POST,OPTIONS')) return;
  if (req.method !== 'POST') return apiError(res, 405, 'Método no permitido');

  const { mensaje, contexto } = req.body ?? {};
  if (!mensaje || typeof mensaje !== 'string' || mensaje.trim().length < 3) {
    return apiError(res, 422, 'El campo "mensaje" es requerido (mín. 3 caracteres)');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return apiError(res, 500, 'ANTHROPIC_API_KEY no configurada');

  const systemPrompt = [
    'Sos un asesor técnico experto en ferretería industrial y doméstica de Uruguay.',
    'Respondés en español rioplatense, de forma clara, concisa y práctica.',
    'Si te preguntan por productos, mencioná marcas conocidas en Uruguay cuando corresponda.',
    'Máximo 3 párrafos. Sin markdown ni listas a menos que sea necesario.',
    contexto ? `Contexto del sistema: ${contexto}` : ''
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 400,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: mensaje.trim() }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[IA] Anthropic error:', err);
      return apiError(res, 502, 'Error al consultar el modelo de IA', err);
    }

    const data      = await response.json();
    const respuesta = data.content?.[0]?.text ?? 'Sin respuesta del modelo';

    return apiOk(res, { respuesta, modelo: data.model, tokens: data.usage });
  } catch (error) {
    console.error('[POST /api/ia/suggestions]', error);
    return apiError(res, 500, 'Error interno en asesor IA', error.message);
  }
}
