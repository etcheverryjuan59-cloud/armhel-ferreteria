import {
  FieldValue, apiError, apiOk, col,
  emitEvent, setCors, verifyUser
} from '../../lib/firebase.js';

export default async function handler(req, res) {
  if (setCors(req, res, 'GET,PATCH,DELETE,OPTIONS')) return;

  const orgId = req.headers['x-org-id'] ?? process.env.DEFAULT_ORG_ID;
  const { id } = req.query;
  if (!orgId) return apiError(res, 400, 'Falta X-Org-Id');
  if (!id)    return apiError(res, 400, 'Falta ID de producto');

  if (req.method === 'GET')    return getProduct(req, res, orgId, id);
  if (req.method === 'PATCH')  return updateProduct(req, res, orgId, id);
  if (req.method === 'DELETE') return deleteProduct(req, res, orgId, id);
  return apiError(res, 405, 'Método no permitido');
}

async function getProduct(req, res, orgId, id) {
  const snap = await col.products(orgId).doc(id).get();
  if (!snap.exists || snap.data().active === false) return apiError(res, 404, 'Producto no encontrado');

  const product = snap.data();
  if (!product.visibleInStore) {
    const user = await verifyUser(req, orgId, 'viewer').catch(() => ({}));
    if (!user.userId || user.forbidden) return apiError(res, 401, 'No autenticado');
  }

  return apiOk(res, { product: { firestoreId: snap.id, ...product } });
}

async function updateProduct(req, res, orgId, id) {
  const user = await verifyUser(req, orgId, 'operator').catch(() => ({}));
  if (!user.userId)   return apiError(res, 401, 'No autenticado');
  if (user.forbidden) return apiError(res, 403, 'Sin permiso');

  const ref  = col.products(orgId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return apiError(res, 404, 'Producto no encontrado');

  const prev = snap.data();
  const body = { ...(req.body ?? {}) };
  ['id', 'orgId', 'createdBy', 'createdAt', 'totalSold', 'totalRevenue'].forEach(f => delete body[f]);

  const updates      = { ...body, updatedAt: FieldValue.serverTimestamp() };
  const priceChanged = body.costPrice !== undefined && body.costPrice !== prev.costPrice;
  if (priceChanged) updates.lastPriceUpdateAt = FieldValue.serverTimestamp();

  const newStock  = body.stock    ?? prev.stock;
  const stockMin  = body.stockMin ?? prev.stockMin;
  const stockAlert = Number(newStock) < Number(stockMin);

  await ref.update(updates);

  await emitEvent(orgId, 'product:updated', {
    entityType:  'product',
    entityId:    id,
    entityLabel: `${prev.sku} · ${prev.name}`,
    message:     `Producto <strong>${prev.name}</strong> actualizado`,
    tone:        'blue',
    actorType:   'user',
    actorId:     user.userId,
    detail:      { fields: Object.keys(body), priceChanged }
  });

  if (priceChanged) {
    await emitEvent(orgId, 'product:price_changed', {
      entityType:  'product',
      entityId:    id,
      entityLabel: `${prev.sku} · ${prev.name}`,
      message:     `Precio de <strong>${prev.name}</strong> modificado · ${prev.costPrice} → ${body.costPrice}`,
      tone:        'amber',
      actorType:   'user',
      actorId:     user.userId,
      detail:      { oldPrice: prev.costPrice, newPrice: body.costPrice, currency: prev.costCurrency }
    });
  }

  if (stockAlert && body.stock !== undefined) {
    await emitEvent(orgId, 'stock:below_minimum', {
      entityType:  'product',
      entityId:    id,
      entityLabel: `${prev.sku} · ${prev.name}`,
      message:     `Stock de <strong>${prev.name}</strong> por debajo del mínimo (${newStock} / mín ${stockMin})`,
      tone:        'red',
      actorType:   'system',
      detail:      { currentStock: newStock, stockMin, productName: prev.name, sku: prev.sku }
    });
  }

  const updated = await ref.get();
  return apiOk(res, { product: { firestoreId: updated.id, ...updated.data() } });
}

async function deleteProduct(req, res, orgId, id) {
  const user = await verifyUser(req, orgId, 'admin').catch(() => ({}));
  if (!user.userId)   return apiError(res, 401, 'No autenticado');
  if (user.forbidden) return apiError(res, 403, 'Sin permiso');

  const ref  = col.products(orgId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return apiError(res, 404, 'Producto no encontrado');
  const prev = snap.data();

  await ref.update({ active: false, updatedAt: FieldValue.serverTimestamp() });

  await emitEvent(orgId, 'product:deleted', {
    entityType:  'product',
    entityId:    id,
    entityLabel: `${prev.sku} · ${prev.name}`,
    message:     `Producto <strong>${prev.name}</strong> desactivado del catálogo`,
    tone:        'red',
    actorType:   'user',
    actorId:     user.userId
  });

  return apiOk(res, { deleted: true });
}
