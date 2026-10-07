// components/bottom-nav.js
// Reusable bottom navigation for every page in the collector app.
// Items with a `perm` are removed by session.js for roles without it.
// Usage:  import { mountBottomNav } from './components/bottom-nav.js';
//         mountBottomNav('home');

const NAV_ITEMS = [
  { key: 'home',         label: 'Home',         icon: 'fa-solid fa-house',              href: 'dashboard.html' },
  { key: 'customers',    label: 'Customers',    icon: 'fa-solid fa-users',              href: 'customers.html' },
  { key: 'transactions', label: 'Transactions', icon: 'fa-solid fa-right-left',         href: 'transactions.html', perm: 'transactions.view' },
  { key: 'sms',          label: 'SMS',          icon: 'fa-solid fa-comment-sms',        href: 'sms.html',          perm: 'sms.send' },
  { key: 'reports',      label: 'Reports',      icon: 'fa-solid fa-chart-column',       href: 'reports.html',      perm: 'reports.view' },
  { key: 'profile',      label: 'Profile',      icon: 'fa-solid fa-circle-user',        href: 'profile.html' }
];

export function mountBottomNav(activeKey = 'home') {
  // Remove any previous mount (safe when hot-reloading or re-mounting)
  const existing = document.getElementById('asv-bottom-nav');
  if (existing) existing.remove();

  const nav = document.createElement('nav');
  nav.id = 'asv-bottom-nav';
  nav.setAttribute('aria-label', 'Primary navigation');
  nav.className = [
    'fixed inset-x-0 bottom-0 z-40',
    'bg-white/95 backdrop-blur-md',
    'border-t border-stone-200',
    'shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.05)]',
    'pb-[env(safe-area-inset-bottom)]'
  ].join(' ');

  nav.innerHTML = `
    <div class="mx-auto max-w-2xl px-2">
      <ul class="flex">
        ${NAV_ITEMS.map((item) => {
          const active = item.key === activeKey;
          const color  = active
            ? 'text-[#C59A3F]'
            : 'text-stone-400 hover:text-stone-700';
          const weight = active ? 'font-bold' : 'font-medium';
          const aria   = active ? 'aria-current="page"' : '';
          const perm   = item.perm ? `data-perm="${item.perm}"` : '';
          return `
            <li class="flex-1" ${perm}>
              <a href="${item.href}" ${aria}
                 class="flex flex-col items-center justify-center gap-1 py-3 transition-colors ${color}">
                <i class="${item.icon} text-[18px]"></i>
                <span class="text-[10.5px] tracking-tight ${weight}">${item.label}</span>
              </a>
            </li>`;
        }).join('')}
      </ul>
    </div>
  `;

  document.body.appendChild(nav);

  // Reserve room so page content is never hidden behind the nav
  document.body.style.paddingBottom = '76px';
}