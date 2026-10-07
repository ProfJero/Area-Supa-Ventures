// Customer search shared by the customers list and the SMS recipient picker.
// Matches a customer ID (current or legacy), Tel 1 / Tel 2, or the start of
// any of the customer's names.
import {
  collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';

function localPhone(digits) {
  if (/^0\d{9}$/.test(digits)) return digits;
  if (/^\d{9}$/.test(digits)) return '0' + digits;
  if (/^233\d{9}$/.test(digits)) return '0' + digits.slice(3);
  return digits;
}

export async function searchCustomers(raw, { branch = '' } = {}) {
  const q = raw.trim();
  const col = collection(db, 'customers');
  const digits = q.replace(/\D/g, '');
  const acct = /^asv[-\s]?\d+$/i.test(q) ? 'ASV-' + digits : (/^\d{4,6}$/.test(q) ? 'ASV-' + q : null);
  const jobs = [];

  if (acct) {
    jobs.push(getDocs(query(col, where('accountNumber', '==', acct), limit(5))));
    jobs.push(getDocs(query(col, where('legacyAccountNumber', '==', acct), limit(5))));
  }
  if (digits.length >= 9) {
    const local = localPhone(digits);
    for (const v of new Set([local, digits, '233' + local.slice(1)])) {
      jobs.push(getDocs(query(col, where('phoneNormalized', '==', v), limit(10))));
    }
    jobs.push(getDocs(query(col, where('tel2Normalized', '==', local), limit(10))));
  }
  if (!digits || /[a-z]/i.test(q.replace(/^asv/i, ''))) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const first = words[0].replace(/[^a-z0-9']/g, '').slice(0, 15);
    if (first) {
      jobs.push(getDocs(query(col, where('nameKeywords', 'array-contains', first), orderBy('fullNameLower'), limit(40))));
    }
    const lower = q.toLowerCase();
    jobs.push(getDocs(query(col, where('fullNameLower', '>=', lower), where('fullNameLower', '<=', lower + ''), orderBy('fullNameLower'), limit(20))));
  }

  const results = await Promise.allSettled(jobs);
  const seen = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const d of r.value.docs) if (!seen.has(d.id)) seen.set(d.id, { id: d.id, ...d.data() });
  }
  if (results.length && results.every((r) => r.status === 'rejected')) throw results[0].reason;

  let list = [...seen.values()];
  // Every word typed must start one of the customer's names.
  const words = q.toLowerCase().split(/\s+/).filter((w) => /[a-z]/.test(w) && !/^asv/.test(w));
  if (words.length > 1) {
    list = list.filter((c) => {
      const parts = String(c.fullName || '').toLowerCase().split(/[\s-]+/);
      return words.every((w) => parts.some((p) => p.startsWith(w)));
    });
  }
  if (branch) list = list.filter((c) => c.branch === branch);
  return list.sort((a, b) => String(a.fullNameLower || '').localeCompare(String(b.fullNameLower || '')));
}
