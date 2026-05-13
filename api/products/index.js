import {
  FieldValue, apiError, apiOk, col,
  emitEvent, parseLimit, setCors, verifyUser
} from '../../lib/firebase.js';

export default async function handler(req, res) {
  if (setCors(req, res, 'GET,POST,OPTIONS')) return;

  const orgId = req.headers['x-org-id'] ?? process.env.DEFAULT_ORG_ID;
  if (!orgId) return apiError(res, 400, 'Falta X-Org-Id');

  if (req.method === 'GET')  return listProducts(req, res, orgId);
  if (req.method === 'POST') return createProduct(req, res, orgId);
  return apiError(res, 405, 'Método no permitido');
}

async function listProducts(req, res, orgId) {
  try {
    const { category, search, featured, store, catalog, supplierId, cursor } = req.query;
    const limit = parseLimit(req.query.limit, 50, 200);
    let query = col.products(orgId).where('active', '==', true);

    if (store    === 'true') query = query.where('visibleInStore',   '==', true);
    if (catalog  === 'true') query = query.where('visibleInCatalog', '==', true);
    if (featured === 'true') query = query.where('featured',         '==', true);
    if (category)            query = query.where('category',         '==', category);
    if (supplierId)          query = query.where('supplierId',       '==', supplierId);

    query = query.orderBy('updatedAt', 'desc').limit(limit);

    if (cursor) {
      const cursorDoc = await col.products(orgId).doc(cursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snapshot = await query.get();
    let products = snapshot.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() }));

    // Si no viene flag de tienda, verificar auth para no filtrar datos internos
    if (store !== 'true') {
      const user = await verifyUser(req, orgId, 'viewer').catch(() => ({}));
      if (!user.userId || user.forbidden) {
        products = products.filter(p => p.visibleInStore === true);
      }
    }

    if (search) {
      const q = String(search).toLowerCase();
      products = products.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q)  ||
        p.brand?.toLowerCase().includes(q)||
        p.description?.toLowerCase().includes(q)
      );
    }

    return apiOk(res, { products, count: products.length, nextCursor: snapshot.docs.at(-1)?.id ?? null });
  } catch (error) {
    console.error('[GET /api/products]', error);
    return apiError(res, 500, 'Error al obtener productos', error.message);
  }
}

async function createProduct(req, res, orgId) {
  const user = await verifyUser(req, orgId, 'operator').catch(() => ({}));
  if (!user.userId)   return apiError(res, 401, 'No autenticado');
  if (user.forbidden) return apiError(res, 403, 'Sin permiso');

  try {
    const body = req.body ?? {};
    const err  = validateProduct(body);
    if (err) return apiError(res, 422, err);

    const skuCheck = await col.products(orgId).where('sku', '==', body.sku).limit(1).get();
    if (!skuCheck.empty) return apiError(res, 409, `El SKU "${body.sku}" ya existe`);

    const ref     = col.products(orgId).doc();
    const now     = FieldValue.serverTimestamp();
    const product = normalizeProduct({ ...body, id: ref.id, orgId, createdBy: user.userId, createdAt: now, updatedAt: now });

    await ref.set(product);

    await emitEvent(orgId, 'product:created', {
      entityType:  'product',
      entityId:    ref.id,
      entityLabel: `${product.sku} · ${product.name}`,
      message:     `Producto <strong>${product.name}</strong> creado en el catálogo`,
      tone:        'green',
      actorType:   'user',
      actorId:     user.userId
    });

    return apiOk(res, { product }, 201);
  } catch (error) {
    console.error('[POST /api/products]', error);
    return apiError(res, 500, 'Error al crear producto', error.message);
  }
}

export function validateProduct(body) {
  if (!body.sku || !body.name || !body.category) return 'Faltan campos requeridos: sku, name, category';
  if (typeof body.costPrice !== 'number' || typeof body.salePrice !== 'number') return 'costPrice y salePrice deben ser números';
  if (body.salePrice < 0 || body.costPrice < 0) return 'Los precios no pueden ser negativos';
  return null;
}

export function normalizeProduct(body) {
  const margin = body.defaultMargin ?? (body.costPrice
    ? ((body.salePrice - body.costPrice) / body.costPrice) * 100 : 0);

  return {
    id:                body.id,
    orgId:             body.orgId,
    sku:               body.sku,
    name:              body.name,
    brand:             body.brand           ?? '',
    description:       body.description     ?? '',
    category:          body.category,
    subcategory:       body.subcategory      ?? '',
    tags:              body.tags             ?? [],
    imageUrl:          body.imageUrl         ?? '',
    images:            body.images           ?? [],
    supplierId:        body.supplierId       ?? null,
    supplierSku:       body.supplierSku      ?? '',
    costPrice:         body.costPrice,
    costCurrency:      body.costCurrency     ?? 'UYU',
    salePrice:         body.salePrice,
    saleCurrency:      body.saleCurrency     ?? 'UYU',
    defaultMargin:     Number(margin.toFixed?.(2) ?? margin),
    tax:               body.tax              ?? 22,
    stock:             body.stock            ?? 0,
    stockMin:          body.stockMin         ?? 5,
    stockUnit:         body.stockUnit        ?? 'unidad',
    variations:        body.variations       ?? [],
    visibleInStore:    body.visibleInStore   ?? false,
    visibleInCatalog:  body.visibleInCatalog ?? true,
    featured:          body.featured         ?? false,
    totalSold:         0,
    totalRevenue:      0,
    lastSoldAt:        null,
    lastPriceUpdateAt: null,
    relatedProductIds: body.relatedProductIds ?? [],
    documents:         body.documents        ?? [],
    active:            true,
    createdBy:         body.createdBy,
    createdAt:         body.createdAt,
    updatedAt:         body.updatedAt
  };
}
