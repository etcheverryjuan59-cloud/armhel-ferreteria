import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3, owner: 4 };

function getPrivateKey() {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
}

export function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = getPrivateKey();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY');
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function db() {
  getAdminApp();
  return getFirestore();
}

export { FieldPath, FieldValue, Timestamp };

export const col = {
  orgs:        ()       => db().collection('organizations'),
  users:       ()       => db().collection('users'),
  products:    (orgId)  => db().collection('organizations').doc(orgId).collection('products'),
  suppliers:   (orgId)  => db().collection('organizations').doc(orgId).collection('suppliers'),
  clients:     (orgId)  => db().collection('organizations').doc(orgId).collection('clients'),
  quotations:  (orgId)  => db().collection('organizations').doc(orgId).collection('quotations'),
  orders:      (orgId)  => db().collection('organizations').doc(orgId).collection('orders'),
  activities:  (orgId)  => db().collection('organizations').doc(orgId).collection('activities'),
  automations: (orgId)  => db().collection('organizations').doc(orgId).collection('automations'),
  tasks:       (orgId)  => db().collection('organizations').doc(orgId).collection('tasks')
};

export function setCors(req, res, methods = 'GET,OPTIONS') {
  const origin = process.env.STORE_ORIGIN ?? '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Org-Id');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export function apiOk(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, ...serialize(data) });
}

export function apiError(res, status, message, detail) {
  return res.status(status).json({ ok: false, error: { message, detail } });
}

export function parseLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date)      return value.toISOString();
  if (Array.isArray(value))       return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

export async function verifyUser(req, orgId, minRole = 'viewer') {
  const header = req.headers.authorization ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return {};

  const decoded    = await getAuth(getAdminApp()).verifyIdToken(token);
  const userSnap   = await col.users().doc(decoded.uid).get();
  const membership = userSnap.data()?.memberships?.[orgId];
  const role       = decoded.role ?? membership?.role;
  const active     = membership?.active !== false;

  if (!role || !active) return { userId: decoded.uid, role: null };
  if (!roleAtLeast(role, minRole)) return { userId: decoded.uid, role, forbidden: true };
  return { userId: decoded.uid, role, email: decoded.email ?? userSnap.data()?.email ?? null };
}

export function roleAtLeast(role, minRole) {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[minRole] ?? 0);
}

export function generateQuotationId(sequence, year = new Date().getFullYear()) {
  return `COT-${year}-${String(sequence).padStart(4, '0')}`;
}

export function calcQuotationTotals(groups = [], exchangeRate = 39.42) {
  const lines = groups.flatMap(g => g.lines ?? []);
  let subtotal = 0, discountTotal = 0, marginAmount = 0, taxTotal = 0, total = 0;

  for (const line of lines) {
    const qty      = Number(line.qty      ?? 0);
    const unit     = Number(line.unit     ?? line.unitPrice ?? 0);
    const discount = Number(line.discount ?? 0);
    const tax      = Number(line.tax      ?? 22);
    const margin   = Number(line.margin   ?? 0);
    const fx       = line.currency === 'USD' ? exchangeRate
                   : line.currency === 'EUR' ? exchangeRate * 1.08 : 1;

    const base          = qty * unit * fx;
    const discountValue = base * discount / 100;
    const afterDiscount = base - discountValue;
    const marginValue   = afterDiscount * margin / 100;
    const taxable       = afterDiscount + marginValue;
    const taxValue      = taxable * tax / 100;

    subtotal      += afterDiscount;
    discountTotal += discountValue;
    marginAmount  += marginValue;
    taxTotal      += taxValue;
    total         += taxable + taxValue;
  }

  return {
    subtotal:      roundMoney(subtotal),
    discountTotal: roundMoney(discountTotal),
    taxTotal:      roundMoney(taxTotal),
    marginAmount:  roundMoney(marginAmount),
    marginAvg:     subtotal ? Number((marginAmount / subtotal * 100).toFixed(2)) : 0,
    total:         roundMoney(total)
  };
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export async function emitEvent(orgId, event, payload = {}) {
  const ref      = col.activities(orgId).doc();
  const activity = {
    id:          ref.id,
    orgId,
    event,
    entityType:  payload.entityType  ?? 'system',
    entityId:    payload.entityId    ?? null,
    entityLabel: payload.entityLabel ?? '',
    message:     payload.message     ?? event,
    tone:        payload.tone        ?? 'blue',
    actorType:   payload.actorType   ?? 'system',
    actorId:     payload.actorId     ?? null,
    detail:      payload.detail      ?? {},
    createdAt:   FieldValue.serverTimestamp()
  };

  await ref.set(activity);
  await runAutomations(orgId, event, { ...activity, id: ref.id, detail: payload.detail ?? {} });
  return ref.id;
}

async function runAutomations(orgId, event, activity) {
  const snap = await col.automations(orgId)
    .where('active', '==', true)
    .where('trigger.event', '==', event)
    .get();

  await Promise.all(snap.docs.map(async doc => {
    const automation = doc.data();
    if (!matchesFilters(activity, automation.trigger?.filters ?? {})) return;
    for (const action of automation.actions ?? []) await executeAction(orgId, action, activity);
    await doc.ref.update({ lastRunAt: FieldValue.serverTimestamp(), runCount: FieldValue.increment(1) });
  }));
}

function matchesFilters(activity, filters) {
  return Object.entries(filters).every(([key, expected]) => {
    const actual = key.split('.').reduce((v, part) => v?.[part], activity);
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
}

async function executeAction(orgId, action, activity) {
  if (action.type === 'create_task') {
    const ref = col.tasks(orgId).doc();
    await ref.set({
      id:            ref.id,
      orgId,
      title:         renderTemplate(action.params?.title ?? activity.message, activity),
      status:        'open',
      priority:      action.params?.priority  ?? 'normal',
      assignedTo:    action.params?.assignedTo ?? null,
      sourceEventId: activity.id,
      dueAt:         action.params?.dueAt ? new Date(action.params.dueAt) : null,
      createdAt:     FieldValue.serverTimestamp(),
      updatedAt:     FieldValue.serverTimestamp()
    });
  }

  if (action.type === 'activity') {
    await col.activities(orgId).add({
      orgId,
      event:       'automation:action_executed',
      entityType:  activity.entityType,
      entityId:    activity.entityId,
      entityLabel: activity.entityLabel,
      message:     renderTemplate(action.params?.message ?? 'Automatización ejecutada', activity),
      tone:        action.params?.tone ?? 'blue',
      actorType:   'system',
      actorId:     null,
      detail:      { automationAction: action.type, sourceEventId: activity.id },
      createdAt:   FieldValue.serverTimestamp()
    });
  }

  if (action.type === 'webhook' && action.params?.url) {
    await fetch(action.params.url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ orgId, action, activity })
    });
  }
}

function renderTemplate(template, activity) {
  return String(template)
    .replaceAll('{{event}}',       activity.event)
    .replaceAll('{{entityLabel}}', activity.entityLabel)
    .replaceAll('{{message}}',     activity.message);
}
