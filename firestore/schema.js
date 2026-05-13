export const ROLES = ['owner', 'admin', 'operator', 'viewer'];

export const EVENTS = [
  'product:created',
  'product:updated',
  'product:price_changed',
  'product:deleted',
  'stock:below_minimum',
  'quotation:created',
  'quotation:sent',
  'quotation:approved',
  'quotation:rejected',
  'quotation:at_risk',
  'quotation:expired',
  'quotation:deleted',
  'pdf:exported',
  'order:created',
  'order:paid',
  'order:payment_failed',
  'automation:action_executed'
];

export const FIRESTORE_SCHEMA = {
  users: {
    path: 'users/{userId}',
    fields: {
      email:       'string',
      displayName: 'string',
      memberships: 'map<orgId,{ role, active, joinedAt }>',
      createdAt:   'timestamp',
      updatedAt:   'timestamp'
    }
  },
  organizations: {
    path: 'organizations/{orgId}',
    fields: {
      name:              'string',
      legalName:         'string',
      country:           'string',
      quotationSequence: 'number',
      settings: {
        exchangeRate:    'number',
        defaultValidity: 'number',
        taxDefault:      'number',
        baseCurrency:    'UYU|USD|EUR'
      },
      branding: {
        logoUrl:     'string',
        accentColor: 'string',
        pdfTemplate: 'string'
      }
    }
  },
  products: {
    path:     'organizations/{orgId}/products/{productId}',
    required: ['sku', 'name', 'category', 'costPrice', 'salePrice'],
    fields: {
      sku:               'string',
      name:              'string',
      brand:             'string',
      description:       'string',
      category:          'string',
      subcategory:       'string',
      tags:              'string[]',
      supplierId:        'string|null',
      supplierSku:       'string',
      costPrice:         'number',
      costCurrency:      'UYU|USD|EUR',
      salePrice:         'number',
      saleCurrency:      'UYU|USD|EUR',
      defaultMargin:     'number',
      tax:               'number',
      stock:             'number',
      stockMin:          'number',
      stockUnit:         'string',
      variations:        'array<{ id, label, sku, costPrice, salePrice, stock }>',
      visibleInStore:    'boolean',
      visibleInCatalog:  'boolean',
      featured:          'boolean',
      active:            'boolean',
      totalSold:         'number',
      totalRevenue:      'number',
      lastSoldAt:        'timestamp|null',
      lastPriceUpdateAt: 'timestamp|null',
      relatedProductIds: 'string[]',
      documents:         'array<{ name, url, type }>'
    }
  },
  suppliers: {
    path: 'organizations/{orgId}/suppliers/{supplierId}',
    fields: {
      name:         'string',
      contactName:  'string',
      email:        'string',
      phone:        'string',
      whatsapp:     'string',
      categories:   'string[]',
      paymentTerms: 'string',
      leadTimeDays: 'number',
      active:       'boolean'
    }
  },
  clients: {
    path: 'organizations/{orgId}/clients/{clientId}',
    fields: {
      name:            'string',
      legalName:       'string',
      rut:             'string',
      email:           'string',
      phone:           'string',
      whatsapp:        'string',
      status:          'active|risk|inactive',
      totalQuotations: 'number',
      totalRevenue:    'number',
      lastQuotationAt: 'timestamp|null',
      lastActivityAt:  'timestamp|null'
    }
  },
  quotations: {
    path: 'organizations/{orgId}/quotations/{quotationId}',
    fields: {
      clientId:      'string|null',
      clientName:    'string',
      status:        'draft|sent|approved|rejected|at_risk|expired',
      currency:      'UYU|USD|EUR',
      exchangeRate:  'number',
      validity:      'number',
      expiresAt:     'timestamp',
      groups:        'array<{ name, lines[] }>',
      subtotal:      'number',
      discountTotal: 'number',
      taxTotal:      'number',
      marginAvg:     'number',
      total:         'number',
      pdfUrl:        'string|null',
      history:       'array'
    }
  },
  orders: {
    path: 'organizations/{orgId}/orders/{orderId}',
    fields: {
      quotationId:  'string|null',
      clientId:     'string|null',
      channel:      'quotation|store|manual',
      status:       'pending|paid|failed|cancelled|fulfilled',
      items:        'array',
      total:        'number',
      mpPaymentId:  'string|null',
      mpStatus:     'string|null',
      paidAt:       'timestamp|null'
    }
  },
  activities: {
    path: 'organizations/{orgId}/activities/{activityId}',
    fields: {
      event:       'string',
      entityType:  'string',
      entityId:    'string',
      entityLabel: 'string',
      message:     'string',
      tone:        'blue|green|amber|red',
      actorType:   'user|system|webhook',
      actorId:     'string|null',
      detail:      'map',
      createdAt:   'timestamp'
    }
  },
  automations: {
    path: 'organizations/{orgId}/automations/{automationId}',
    fields: {
      active:    'boolean',
      name:      'string',
      trigger:   '{ event, filters }',
      actions:   'array<{ type, params }>',
      lastRunAt: 'timestamp|null',
      runCount:  'number'
    }
  },
  tasks: {
    path: 'organizations/{orgId}/tasks/{taskId}',
    fields: {
      title:         'string',
      status:        'open|done|cancelled',
      priority:      'low|normal|high|critical',
      assignedTo:    'string|null',
      sourceEventId: 'string|null',
      dueAt:         'timestamp|null'
    }
  }
};

export const RECOMMENDED_INDEXES = [
  { collectionGroup: 'products',    fields: ['active', 'visibleInStore',   'updatedAt desc'] },
  { collectionGroup: 'products',    fields: ['active', 'visibleInCatalog', 'updatedAt desc'] },
  { collectionGroup: 'products',    fields: ['active', 'category',         'updatedAt desc'] },
  { collectionGroup: 'quotations',  fields: ['status',      'createdAt desc'] },
  { collectionGroup: 'quotations',  fields: ['clientId',    'createdAt desc'] },
  { collectionGroup: 'activities',  fields: ['event',       'createdAt desc'] },
  { collectionGroup: 'activities',  fields: ['entityType',  'createdAt desc'] },
  { collectionGroup: 'automations', fields: ['active',      'trigger.event'] }
];
