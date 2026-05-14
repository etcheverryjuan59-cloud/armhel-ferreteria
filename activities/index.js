import { apiError, apiOk, col, parseLimit, setCors, verifyUser } from '../../lib/firebase.js';

export default async function handler(req, res) {
  if (setCors(req, res, 'GET,OPTIONS')) return;
  if (req.method !== 'GET') return apiError(res, 405, 'Método no permitido');

  const orgId = req.headers['x-org-id'] ?? process.env.DEFAULT_ORG_ID;
  if (!orgId) return apiError(res, 400, 'Falta X-Org-Id');

  const user = await verifyUser(req, orgId, 'viewer').catch(() => ({}));
  if (!user.userId)   return apiError(res, 401, 'No autenticado');
  if (user.forbidden) return apiError(res, 403, 'Sin permiso');

  try {
    const { event, entityType, tone, since } = req.query;
    const limit = parseLimit(req.query.limit, 50, 200);
    let query = col.activities(orgId).orderBy('createdAt', 'desc');

    if (event)      query = query.where('event',      '==', event);
    if (entityType) query = query.where('entityType', '==', entityType);
    if (tone)       query = query.where('tone',       '==', tone);
    if (since)      query = query.where('createdAt',  '>=', new Date(since));

    const snapshot   = await query.limit(limit).get();
    const activities = snapshot.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() }));
    return apiOk(res, { activities, count: activities.length });
  } catch (error) {
    console.error('[GET /api/activities]', error);
    return apiError(res, 500, 'Error al obtener actividades', error.message);
  }
}
