'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/auth/actions';

type StaffRole = 'STAFF' | 'SUPERVISOR' | 'ADMIN' | 'SUPER_ADMIN';

type NavBarProps = {
  staff: {
    id: string;
    display_name: string;
    role: StaffRole;
  };
};

const roleLabels: Record<StaffRole, string> = {
  STAFF: 'บุคลากร',
  SUPERVISOR: 'หัวหน้างาน',
  ADMIN: 'ผู้ดูแลระบบ',
  SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด',
};

type NavItem = {
  href: string;
  label: string;
  superAdminOnly?: boolean;
  adminOnly?: boolean;
  icon: ReactNode;
};

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'หน้าหลัก',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="7" height="9" x="3" y="3" rx="2" />
        <rect width="7" height="5" x="14" y="3" rx="2" />
        <rect width="7" height="9" x="14" y="12" rx="2" />
        <rect width="7" height="5" x="3" y="16" rx="2" />
      </svg>
    ),
  },
  {
    href: '/tickets',
    label: 'งานรับเรื่อง',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/incidents',
    label: 'เหตุขัดข้อง',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 2.8 19a1.4 1.4 0 0 0 1.2 2h16a1.4 1.4 0 0 0 1.2-2L12 3Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    ),
  },
  {
    href: '/knowledge',
    label: 'คลังความรู้',
    superAdminOnly: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
        <path d="M6 6h10" />
        <path d="M6 10h10" />
      </svg>
    ),
  },
  {
    href: '/providers',
    label: 'บริการ AI',
    superAdminOnly: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="4" x2="20" y1="12" y2="12" />
        <line x1="4" x2="20" y1="6" y2="6" />
        <line x1="4" x2="20" y1="18" y2="18" />
        <circle cx="8" cy="6" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="10" cy="18" r="2" />
      </svg>
    ),
  },
  {
    href: '/activities',
    label: 'ประวัติและระบบ',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: '/logs',
    label: 'บันทึกระบบ',
    superAdminOnly: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'วิเคราะห์ข้อมูล',
    adminOnly: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3v18h18" /><path d="m7 14 4-4 4 3 6-7" />
      </svg>
    ),
  },
  {
    href: '/usage',
    label: 'การใช้งาน AI',
    superAdminOnly: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19V5M4 19h16" /><path d="M8 15v-3M12 15V7M16 15V9" />
      </svg>
    ),
  },
  {
    href: '/departments',
    label: 'หน่วยงาน',
    adminOnly: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-4h4v4" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'การตั้งค่า',
    adminOnly: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

export default function NavBar({ staff }: NavBarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleBtnRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const prevPathnameRef = useRef(pathname);

  // Close drawer on route change
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      setMobileOpen(false);
    }
  }, [pathname]);

  // Focus trap, Escape key, and body scroll lock for mobile drawer
  useEffect(() => {
    if (!mobileOpen) {
      document.body.style.overflow = '';
      return;
    }

    // Lock body scroll
    document.body.style.overflow = 'hidden';

    // Focus the first focusable element inside the drawer
    const drawerElement = drawerRef.current;
    if (drawerElement) {
      const focusables = drawerElement.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length > 0) {
        focusables[0].focus();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        toggleBtnRef.current?.focus();
        return;
      }

      if (event.key === 'Tab' && drawerElement) {
        const focusableElements = drawerElement.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  function handleCloseDrawer() {
    setMobileOpen(false);
    toggleBtnRef.current?.focus();
  }

  const isSuperAdmin = staff.role === 'SUPER_ADMIN';
  const isAdminOrSuper = staff.role === 'SUPER_ADMIN' || staff.role === 'ADMIN';

  const accessibleItems = navItems.filter(item => {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (item.adminOnly && !isAdminOrSuper) return false;
    return true;
  });

  function isItemActive(href: string) {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/';
    }
    if (href === '/tickets') {
      return pathname.startsWith('/tickets');
    }
    if (href === '/knowledge') {
      return pathname.startsWith('/knowledge');
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const initial = staff.display_name.trim().charAt(0) || 'U';

  return (
    <>
      <a href="#main-content" className="skip-to-content">ข้ามไปเนื้อหาหลัก</a>

      {/* Mobile Top Header */}
      <div className="shell-mobile-bar">
        <Link href="/dashboard" className="shell-mobile-brand" aria-label="หน้าหลัก YRU AI Helpdesk">
          <span className="shell-brand-logo" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z" /></svg></span>
          <strong>YRU AI</strong>
        </Link>
        <button
          ref={toggleBtnRef}
          type="button"
          className="shell-mobile-toggle"
          aria-expanded={mobileOpen}
          aria-controls="shell-sidebar-nav"
          aria-label={mobileOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
          onClick={() => setMobileOpen(prev => !prev)}
        >
          <span className="shell-hamburger-icon" aria-hidden="true" />
        </button>
      </div>

      {/* Backdrop for Mobile */}
      {mobileOpen && (
        <div
          className="shell-sidebar-backdrop"
          onClick={handleCloseDrawer}
          aria-hidden="true"
        />
      )}

      {/* Sleek Dark Icon Sidebar (Linear/Enterprise Reference) */}
      <aside
        ref={drawerRef}
        id="shell-sidebar-nav"
        className={`shell-sidebar ${mobileOpen ? 'is-open' : ''}`}
        aria-label="เมนูหลัก"
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? 'true' : undefined}
      >
        {/* Brand Logo with Sunset Coral Gradient */}
        <div className="shell-sidebar-top">
          <Link href="/dashboard" className="shell-brand-icon" aria-label="หน้าหลัก YRU AI Helpdesk" title="YRU AI Helpdesk">
            <span className="shell-brand-logo" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2Z" /></svg></span>
          </Link>
          {mobileOpen && (
            <button
              type="button"
              className="shell-drawer-close-btn"
              onClick={handleCloseDrawer}
              aria-label="ปิดเมนู"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          )}
        </div>

        {/* Center Icon Navigation */}
        <nav className="shell-sidebar-nav" aria-label="การนำทางหลัก">
          <ul className="shell-nav-list" role="list">
            {accessibleItems.map(item => {
              const active = isItemActive(item.href);
              return (
                <li key={item.href} className="shell-nav-item">
                  <Link
                    href={item.href}
                    className={`shell-nav-link ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={item.label}
                    aria-label={item.label}
                    onClick={() => mobileOpen && setMobileOpen(false)}
                  >
                    <span className="shell-nav-icon">{item.icon}</span>
                    <span className="shell-nav-label-text">{item.label}</span>
                    {active && <span className="shell-nav-indicator" aria-hidden="true" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom Profile & Actions */}
        <div className="shell-sidebar-bottom">
          {/* User Profile Avatar with Online Badge */}
          <div className="shell-user-avatar-wrap" title={`${staff.display_name} (${roleLabels[staff.role]})`}>
            <div className="shell-user-avatar" aria-hidden="true">
              <span>{initial}</span>
            </div>
            <span className="shell-user-status-dot" aria-hidden="true" />
          </div>

          {/* Sign Out Button */}
          <form action={signOutAction} className="shell-signout-form">
            <button
              className="shell-signout-icon-btn"
              type="submit"
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
