// Staff roles and permissions.
//
// THIS FILE IS SHARED: an identical copy lives at
// "Area Supa Ventres/js/lib/roles.js" for the browser. The server copy is the
// one that is enforced; the browser copy only hides buttons. A unit test
// (functions/test/roles.test.js) fails if the two copies drift apart.
// firestore.rules mirrors the read permissions below; keep it in step too.

export const PERMISSIONS = {
  'customers.view':        'View customers and their balances',
  'customers.create':      'Register new customers',
  'customers.edit':        'Edit customer bio data and photos',
  'customers.delete':      'Permanently delete customers',
  'transactions.view':     'View transactions and statements',
  'transactions.deposit':  'Record deposits',
  'transactions.withdraw': 'Record withdrawals',
  'reports.view':          'View reports',
  'sms.send':              'Send SMS to customers',
  'sms.settings':          'Edit SMS templates and automatic messages',
  'sms.billing':           'Buy SMS units',
  'staff.manage':          'Add staff and assign roles',
  'settings.manage':       'Edit business settings and branches',
  'audit.view':            'View the audit log'
};

const ALL = Object.keys(PERMISSIONS);

// rank decides who may manage whom: a staff member can only create or change
// accounts whose role ranks strictly below their own.
export const ROLES = {
  owner: {
    label: 'Owner',
    rank: 100,
    description: 'Full control of the business, including administrators.',
    permissions: ALL
  },
  admin: {
    label: 'Administrator',
    rank: 80,
    description: 'Full access, including deleting customers, SMS billing and managing staff below administrator.',
    permissions: ALL
  },
  manager: {
    label: 'Manager',
    rank: 60,
    description: 'Registers and edits customers, records transactions, views reports and sends SMS.',
    permissions: [
      'customers.view', 'customers.create', 'customers.edit',
      'transactions.view', 'transactions.deposit', 'transactions.withdraw',
      'reports.view', 'sms.send'
    ]
  },
  collector: {
    label: 'Collector',
    rank: 40,
    description: 'Registers customers and records deposits and withdrawals.',
    permissions: [
      'customers.view', 'customers.create',
      'transactions.view', 'transactions.deposit', 'transactions.withdraw'
    ]
  },
  viewer: {
    label: 'Auditor (read only)',
    rank: 20,
    description: 'Can look at customers, transactions and reports but cannot change anything.',
    permissions: ['customers.view', 'transactions.view', 'reports.view']
  }
};

export function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

export function hasPermission(role, permission) {
  return isRole(role) && ROLES[role].permissions.includes(permission);
}

export function canManageRole(actorRole, targetRole) {
  return isRole(actorRole) && isRole(targetRole) &&
    hasPermission(actorRole, 'staff.manage') &&
    ROLES[actorRole].rank > ROLES[targetRole].rank;
}

// Roles the actor is allowed to hand out, highest first.
export function assignableRoles(actorRole) {
  return Object.keys(ROLES)
    .filter((r) => r !== 'owner' && canManageRole(actorRole, r))
    .sort((a, b) => ROLES[b].rank - ROLES[a].rank);
}
