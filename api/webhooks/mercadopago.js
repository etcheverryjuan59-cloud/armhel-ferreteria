import crypto from 'node:crypto';
import {
  FieldValue, apiError, apiOk, col, db,
  emitEvent, setCors
} from '../../lib/firebase.js';

export default async function handler(req, res) {
  if (setCors(req, res, 'POST,OPTIONS')) return;
  if (req.method !== 'POST') return apiError(res, 405, 'Método no permitido');

  const dataId = req.body?.data?.id ?? req.query?.['data.id'] ?? req.query?.id;
  const topic  = req.body?.type     ?? req.body?.topic        ?? req.query?.topic;
  if (!dataId) return apiError(res, 400, 'Falta data.id de Mercado Pago');

  if (!verifyMercadoPagoSignature(req, String(dataId))) {
    return apiError(res, 401, 'Firma Mercado Pago inválida');
  }

  if (!String(topic).includes('payment')) {
    return apiOk(res, { ignored: true, topic });
  }

  try {
    const payment           = await fetchMercadoPagoPayment(dataId);
    const [orgId, orderId]  = String(payment.external_reference ?? '').split(':');
    if (!orgId || !orderId) return apiError(res, 422, 'external_reference inválido (esperado: orgId:orderId)');

    const orderRef  = col.orders(orgId).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return apiError(res, 404, 'Orden no encontrada');

    const order          = orderSnap.data();
    const alreadyApproved = order.mpStatus === 'approved' || order.status === 'paid';
    const approved        = payment.status === 'approved';

    await orderRef.update({
      mpPaymentId: String(payment.id),
      mpStatus:    payment.status,
      status:      approved ? 'paid' : 'failed',
      paidAt:      approved ? FieldValue.serverTimestamp() : (order.paidAt ?? null),
      updatedAt:   FieldValue.serverTimestamp()
    });

    if (approved && !alreadyApproved) {
      await decrementStockFromOrder(orgId, order);
      await emitEvent(orgId, 'order:paid', {
        entityType:  'order',
        entityId:    orderId,
        entityLabel: `Orden · ${order.clientName ?? orderId}`,
        message:     `Pago confirmado por Mercado Pago · orden <strong>${orderId}</strong>`,
        tone:        'green',
        actorType:   'webhook',
        detail:      { mpPaymentId: payment.id, amount: payment.transaction_amount }
      });
    }

    if (!approved) {
      await emitEvent(orgId, 'order:payment_failed', {
        entityType:  'order',
        entityId:    orderId,
        entityLabel: `Orden · ${order.clientName ?? orderId}`,
        message:     `Pago Mercado Pago no aprobado · estado ${payment.status}`,
        tone:        'red',
        actorType:   'webhook',
        detail:      { mpPaymentId: payment.id, status: payment.status }
      });
    }

    return apiOk(res, { received: true, status: payment.status });
  } catch (error) {
    console.error('[POST /api/webhooks/mercadopago]', error);
    return apiError(res, 500, 'Error procesando webhook Mercado Pago', error.message);
  }
}

function verifyMercadoPagoSignature(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // en dev sin secret, se omite verificación

  const signatureHeader = req.headers['x-signature'];
  const requestId       = req.headers['x-request-id'];
  if (!signatureHeader || !requestId) return false;

  const parts = Object.fromEntries(
    String(signatureHeader).split(',').map(part => {
      const [key, value] = part.split('=');
      return [key?.trim(), value?.trim()];
    })
  );

  const { ts, v1 } = parts;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return timingSafeEqual(expected, v1);
}

function timingSafeEqual(a, b) {
  const left  = Buffer.from(String(a), 'hex');
  const right = Buffer.from(String(b), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function fetchMercadoPagoPayment(paymentId) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('Falta MP_ACCESS_TOKEN');

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercado Pago ${response.status}: ${text}`);
  }

  return response.json();
}

async function decrementStockFromOrder(orgId, order) {
  const batch = db().batch();

  for (const item of order.items ?? []) {
    if (!item.productId) continue;
    const productRef = col.products(orgId).doc(item.productId);
    batch.update(productRef, {
      stock:        FieldValue.increment(-Number(item.qty   ?? 0)),
      totalSold:    FieldValue.increment( Number(item.qty   ?? 0)),
      totalRevenue: FieldValue.increment( Number(item.total ?? 0)),
      lastSoldAt:   FieldValue.serverTimestamp(),
      updatedAt:    FieldValue.serverTimestamp()
    });
  }

  await batch.commit();
}
