// SMS template fields.
//
// THIS FILE IS SHARED: an identical copy lives at
// "Area Supa Ventres/js/lib/sms-template.js" for the browser (field picker and
// live preview). functions/test/roles.test.js checks the copies match.
//
// Templates use the ProfJero Connect syntax: {first_name}, or with a fallback
// {first_name|Customer}. The server fills every field for every recipient, so
// a message is never refused for a blank value.

export const CUSTOMER_FIELDS = [
  { key: 'first_name',        label: 'First name',        sample: 'Ama' },
  { key: 'last_name',         label: 'Surname',           sample: 'Boateng' },
  { key: 'full_name',         label: 'Full name',         sample: 'Ama Boateng' },
  { key: 'customer_id',       label: 'Customer ID',       sample: 'ASV-10001' },
  { key: 'phone',             label: 'Phone (Tel 1)',     sample: '0241234567' },
  { key: 'tel2',              label: 'Tel 2',             sample: '0201234567' },
  { key: 'branch',            label: 'Branch',            sample: 'Kumasi Central' },
  { key: 'balance',           label: 'Balance (GH₵)',     sample: '1,250.00' },
  { key: 'registration_date', label: 'Registration date', sample: '04 Oct 2026' },
  { key: 'company',           label: 'Business name',     sample: 'Area Supa Ventures' }
];

export const TRANSACTION_FIELDS = [
  { key: 'amount',           label: 'Amount (GH₵)',     sample: '50.00' },
  { key: 'transaction_type', label: 'Transaction type', sample: 'deposit' },
  { key: 'transaction_date', label: 'Date & time',      sample: '07 Oct 2026, 10:42' },
  { key: 'transaction_ref',  label: 'Reference',        sample: 'TX8F2K1QZ' },
  { key: 'payment_method',   label: 'Payment method',   sample: 'Cash' }
];

export const ALL_FIELDS = [...CUSTOMER_FIELDS, ...TRANSACTION_FIELDS];

const FIELD_RE = /\{([a-zA-Z0-9_]+)(?:\|([^}]*))?\}/g;

// Returns the field names used in a template (without fallbacks).
export function fieldsUsed(template) {
  const out = new Set();
  for (const m of String(template || '').matchAll(FIELD_RE)) out.add(m[1]);
  return [...out];
}

// Returns field names the template uses that we cannot fill.
export function unknownFields(template, { allowTransaction = false } = {}) {
  const allowed = new Set((allowTransaction ? ALL_FIELDS : CUSTOMER_FIELDS).map((f) => f.key));
  return fieldsUsed(template).filter((k) => !allowed.has(k));
}

// Fills a template for previews. Mirrors what ProfJero does when sending.
export function renderTemplate(template, values) {
  return String(template || '').replace(FIELD_RE, (_, key, fallback) => {
    const v = values?.[key];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
    return fallback ?? '';
  });
}

export function sampleValues() {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f.sample]));
}

// GSM-7 vs Unicode page counting, matching ProfJero billing:
// 160 chars (153 per page when longer) or Unicode 70 (67 per page).
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

export function smsPages(text) {
  const s = String(text || '');
  let unicode = false;
  let len = 0;
  for (const ch of s) {
    if (GSM7.includes(ch)) len += 1;
    else if (GSM7_EXT.includes(ch)) len += 2;
    else { unicode = true; break; }
  }
  if (unicode) {
    const n = [...s].length;
    return { unicode: true, length: n, pages: n <= 70 ? 1 : Math.ceil(n / 67) };
  }
  return { unicode: false, length: len, pages: len <= 160 ? 1 : Math.ceil(len / 153) };
}
