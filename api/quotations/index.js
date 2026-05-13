import {
  FieldValue, apiError, apiOk, calcQuotationTotals, col, db,
  emitEvent, generateQuotationId, parseLimit, setCors, verifyUser
} from '../../lib/firebase.js';

export default async function handler(req, res) {
  if (setCors(req, res, 'GET,POST,OPTIONS')) return;

  const orgId = req.headers['x-org-id'] ?? process.env.DEFAULT_ORG_ID;
  if (!orgId) return apiError(res, 400, 'Falta X-Org-Id');

  const user = await verifyUser(req, orgId, 'viewer').catch(() => ({}));
  if (!user.userId)   return apiError(res, 401, 'No autenticado');
  if (user.forbidden) return apiError(res, 403, 'Sin permiso');

  if (req.method === 'GET')  return listQuotations(req, res, orgId);
  if (req.method === 'POST') return createQuotation(req, res, orgId, user);
  return apiError(res, 405, 'Método no permitido');
}

async function listQuotations(req, res, orgId) {
  try {
    const { status, clientId, assignedTo, cursor } = req.query;
    const limit = parseLimit(req.query.limit, 30, 100);
    let query = col.quotations(orgId).orderBy('createdAt', 'desc');

    if (status)     query = query.where('status',     '==', status);
    if (clientId)   query = query.where('clientId',   '==', clientId);
    if (assignedTo) query = query.where('assignedTo', '==', assignedTo);
    query = query.limit(limit);

    if (cursor) {
      const cursorDoc = await col.quotations(orgId).doc(cursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snapshot   = await query.get();
    const quotations = snapshot.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() }));

    return apiOk(res, { quotations, count: quotations.length, nextCursor: snapshot.docs.at(-1)?.id ?? null });
  } catch (error) {
    console.error('[GET /api/quotations]', error);
    return apiError(res, 500, 'Error al obtener cotizaciones', error.message);
  }
}

async function createQuotation(req, res, orgId, user) {
  if (!['owner', 'admin', 'operator'].includes(user.role)) return apiError(res, 403, 'Sin permiso');

  try {
    const body = req.body ?? {};
    if (!body.clientName || !Array.isArray(body.groups)) {
      return apiError(res, 422, 'Faltan campos: clientName, groups');
    }

    const orgRef = col.orgs().doc(orgId);
    let quotationId;

    await db().runTransaction(async tx => {
      const orgSnap = await tx.get(orgRef);
      const current = orgSnap.exists ? (orgSnap.data().quotationSequence ?? 241) : 241;
      const next    = current + 1;
      quotationId   = generateQuotationId(next);
      tx.set(orgRef, { quotationSequence: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });

    const orgSnap      = await orgRef.get();
    const exchangeRate = body.exchangeRate ?? orgSnap.data()?.settings?.exchangeRate ?? 39.42;
    const validity     = body.validity     ?? orgSnap.data()?.settings?.defaultValidity ?? 30;
    const totals       = calcQuotationTotals(body.groups, exchangeRate);
    const expiresAt    = new Date();
    expiresAt.setDate(expiresAt.getDate() + validity);

    const ref = col.quotations(orgId).doc(quotationId);
    const now = FieldValue.serverTimestamp();

    const quotation = {
      id:           quotationId,
      orgId,
      clientId:     body.clientId   ?? null,
      clientName:   body.clientName,
      status:       'draft',
      currency:     body.currency   ?? 'UYU',
      exchangeRate,
      validity,
      expiresAt,
      notes:        body.notes      ?? '',
      project:      body.project    ?? '',
      groups:       body.groups,
      ...totals,
      pdfUrl:           null,
      pdfGeneratedAt:   null,
      history: [{
        status:    'draft',
        changedAt: new Date().toISOString(),
        changedBy: user.userId,
        note:      'Cotización creada'
      }],
      templateName: body.templateName ?? 'corporate-v1',
      createdBy:    user.userId,
      assignedTo:   body.assignedTo  ?? user.userId,
      createdAt:    now,
      updatedAt:    now
    };

    await ref.set(quotation);

    if (body.clientId) {
      await col.clients(orgId).doc(body.clientId).set({
        totalQuotations: FieldValue.increment(1),
        lastQuotationAt: FieldValue.serverTimestamp(),
        lastActivityAt:  FieldValue.serverTimestamp()
      }, { merge: true });
    }

    await emitEvent(orgId, 'quotation:created', {
      entityType:  'quotation',
      entityId:    quotationId,
      entityLabel: `${quotationId} · ${body.clientName}`,
      message:     `Cotización <strong>${quotationId}</strong> creada para ${body.clientName} · $${totals.total.toLocaleString('es-UY')}`,
      tone:        'amber',
      actorType:   'user',
      actorId:     user.userId,
      detail:      { quotationId, total: totals.total, margin: totals.marginAvg, clientId: body.clientId ?? null }
    });

    return apiOk(res, { quotation }, 201);
  } catch (error) {
    console.error('[POST /api/quotations]', error);
    return apiError(res, 500, 'Error al crear cotización', error.message);
  }
}
