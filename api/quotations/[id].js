import {
  FieldValue, apiError, apiOk, calcQuotationTotals, col,
  emitEvent, setCors, verifyUser
} from '../../lib/firebase.js';

const VALID_TRANSITIONS = {
  draft:    ['sent', 'expired'],
  sent:     ['approved', 'rejected', 'at_risk', 'expired'],
  at_risk:  ['approved', 'rejected', 'expired'],
  approved: ['draft'],
  rejected: ['draft'],
  expired:  ['draft']
};

export default async function handler(req, res) {
  if (setCors(req, res, 'GET,PATCH,POST,DELETE,OPTIONS')) return;

  const orgId          = req.headers['x-org-id'] ?? process.env.DEFAULT_ORG_ID;
  const { id, action } = req.query;
  if (!orgId) return apiError(res, 400, 'Falta X-Org-Id');
  if (!id)    return apiError(res, 400, 'Falta ID de cotización');

  const user = await verifyUser(req, orgId, 'viewer').catch(() => ({}));
  if (!user.userId)   return apiError(res, 401, 'No autenticado');
  if (user.forbidden) return apiError(res, 403, 'Sin permiso');

  if (req.method === 'GET')                         return getQuotation(res, orgId, id);
  if (req.method === 'PATCH')                       return updateQuotation(req, res, orgId, id, user);
  if (req.method === 'POST' && action === 'pdf')    return markPdfExported(req, res, orgId, id, user);
  if (req.method === 'DELETE')                      return deleteQuotation(res, orgId, id, user);
  return apiError(res, 405, 'Método no permitido');
}

async function getQuotation(res, orgId, id) {
  const snap = await col.quotations(orgId).doc(id).get();
  if (!snap.exists) return apiError(res, 404, 'Cotización no encontrada');
  return apiOk(res, { quotation: { firestoreId: snap.id, ...snap.data() } });
}

async function updateQuotation(req, res, orgId, id, user) {
  if (!['owner', 'admin', 'operator'].includes(user.role)) return apiError(res, 403, 'Sin permiso');

  const ref  = col.quotations(orgId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return apiError(res, 404, 'Cotización no encontrada');

  const prev = snap.data();
  const body = { ...(req.body ?? {}) };

  if (body.status && body.status !== prev.status) {
    const allowed = VALID_TRANSITIONS[prev.status] ?? [];
    if (!allowed.includes(body.status)) {
      return apiError(res, 422,
        `Transición inválida: ${prev.status} → ${body.status}. Permitidas: ${allowed.join(', ')}`
      );
    }
  }

  let totals = {};
  if (body.groups) totals = calcQuotationTotals(body.groups, body.exchangeRate ?? prev.exchangeRate);

  ['id', 'orgId', 'createdBy', 'createdAt'].forEach(f => delete body[f]);
  const statusNote = body._statusNote ?? '';
  delete body._statusNote;

  const historyEntry = body.status ? {
    status:    body.status,
    changedAt: new Date().toISOString(),
    changedBy: user.userId,
    note:      statusNote
  } : null;

  await ref.update({
    ...body,
    ...totals,
    ...(historyEntry ? { history: FieldValue.arrayUnion(historyEntry) } : {}),
    updatedAt: FieldValue.serverTimestamp()
  });

  if (body.status) await emitQuotationStatusEvent(orgId, id, prev, body.status, user.userId);
  if (body.status === 'approved') await createOrderFromQuotation(orgId, id, prev, user.userId);

  const updated = await ref.get();
  return apiOk(res, { quotation: { firestoreId: updated.id, ...updated.data() } });
}

async function markPdfExported(req, res, orgId, id, user) {
  if (!['owner', 'admin', 'operator'].includes(user.role)) return apiError(res, 403, 'Sin permiso');

  const ref  = col.quotations(orgId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return apiError(res, 404, 'Cotización no encontrada');

  const prev   = snap.data();
  const pdfUrl = req.body?.pdfUrl ?? null;

  await ref.update({
    pdfUrl,
    pdfGeneratedAt: FieldValue.serverTimestamp(),
    history:        FieldValue.arrayUnion({
      status:    prev.status,
      changedAt: new Date().toISOString(),
      changedBy: user.userId,
      note:      'PDF exportado'
    }),
    updatedAt: FieldValue.serverTimestamp()
  });

  await emitEvent(orgId, 'pdf:exported', {
    entityType:  'quotation',
    entityId:    id,
    entityLabel: `${prev.id} · ${prev.clientName}`,
    message:     `PDF generado para <strong>${prev.id}</strong> · ${prev.clientName}`,
    tone:        'green',
    actorType:   'user',
    actorId:     user.userId,
    detail:      { pdfUrl, quotationId: prev.id }
  });

  return apiOk(res, { exported: true, pdfUrl });
}

async function deleteQuotation(res, orgId, id, user) {
  if (!['owner', 'admin'].includes(user.role)) return apiError(res, 403, 'Sin permiso');

  const ref  = col.quotations(orgId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return apiError(res, 404, 'Cotización no encontrada');

  const prev = snap.data();
  if (prev.status !== 'draft') {
    return apiError(res, 422, 'Solo se pueden eliminar cotizaciones en estado draft');
  }

  await ref.delete();

  await emitEvent(orgId, 'quotation:deleted', {
    entityType:  'quotation',
    entityId:    id,
    entityLabel: `${prev.id} · ${prev.clientName}`,
    message:     `Cotización <strong>${prev.id}</strong> eliminada`,
    tone:        'red',
    actorType:   'user',
    actorId:     user.userId
  });

  return apiOk(res, { deleted: true });
}

async function emitQuotationStatusEvent(orgId, id, quotation, status, userId) {
  const eventMap = {
    sent:     ['quotation:sent',     'blue',  `Cotización <strong>${quotation.id}</strong> enviada a ${quotation.clientName}`],
    approved: ['quotation:approved', 'green', `Cotización <strong>${quotation.id}</strong> aprobada · ${quotation.clientName}`],
    rejected: ['quotation:rejected', 'red',   `Cotización <strong>${quotation.id}</strong> rechazada · ${quotation.clientName}`],
    at_risk:  ['quotation:at_risk',  'amber', `Cotización <strong>${quotation.id}</strong> marcada en riesgo`],
    expired:  ['quotation:expired',  'red',   `Cotización <strong>${quotation.id}</strong> vencida`]
  };
  const mapped = eventMap[status];
  if (!mapped) return;
  const [event, tone, message] = mapped;

  await emitEvent(orgId, event, {
    entityType:  'quotation',
    entityId:    id,
    entityLabel: `${quotation.id} · ${quotation.clientName}`,
    message,
    tone,
    actorType:   'user',
    actorId:     userId,
    detail:      { status, total: quotation.total, clientId: quotation.clientId ?? null }
  });
}

async function createOrderFromQuotation(orgId, quotationId, quotation, userId) {
  const orderRef  = col.orders(orgId).doc(quotationId);
  const existing  = await orderRef.get();
  if (existing.exists) return;

  const items = (quotation.groups ?? []).flatMap(group =>
    (group.lines ?? []).map(line => ({
      productId: line.productId ?? null,
      sku:       line.sku       ?? null,
      name:      line.desc      ?? line.name,
      qty:       Number(line.qty  ?? 0),
      unitPrice: Number(line.unit ?? line.unitPrice ?? 0),
      currency:  line.currency  ?? quotation.currency,
      total:     Number(line.qty ?? 0) * Number(line.unit ?? line.unitPrice ?? 0)
    }))
  );

  await orderRef.set({
    id:             orderRef.id,
    orgId,
    quotationId,
    clientId:       quotation.clientId   ?? null,
    clientName:     quotation.clientName,
    channel:        'quotation',
    status:         'pending',
    items,
    subtotal:       quotation.subtotal,
    tax:            quotation.taxTotal,
    total:          quotation.total,
    currency:       quotation.currency,
    mpPreferenceId: null,
    mpPaymentId:    null,
    mpStatus:       null,
    paidAt:         null,
    createdBy:      userId,
    createdAt:      FieldValue.serverTimestamp(),
    updatedAt:      FieldValue.serverTimestamp()
  });

  await emitEvent(orgId, 'order:created', {
    entityType:  'order',
    entityId:    orderRef.id,
    entityLabel: `Orden · ${quotation.clientName}`,
    message:     `Orden creada automáticamente desde <strong>${quotation.id}</strong>`,
    tone:        'green',
    actorType:   'system',
    detail:      { quotationId, total: quotation.total }
  });
}
