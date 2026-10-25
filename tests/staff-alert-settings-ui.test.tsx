import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { IncidentRulesView } from '@/lib/incidents/reads';
import { IncidentRulesEditor, createIncidentRulesSaveAction } from '@/app/(dashboard)/incidents/IncidentActions';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const saved: IncidentRulesView = {
  revision: 7,
  rules: { minReports: 5, minDistinctSessions: 3, windowMinutes: 15, minSimilarity: 0.85 },
  notifications: { debounceSeconds: 30 },
};
const formData = (wait?: string) => {
  const data = new FormData();
  data.set('minReports', '5');
  data.set('minDistinctSessions', '3');
  data.set('windowMinutes', '15');
  data.set('minSimilarity', '0.85');
  if (wait !== undefined) data.set('debounceSeconds', wait);
  return data;
};
const html = (node: ReactNode) => renderToStaticMarkup(node);

describe('staff alert settings UI', () => {
  it('renders the observed wait and explains the finite grouping and urgent path', () => {
    const markup = html(<IncidentRulesEditor initial={saved} canManage />);
    expect(markup).toContain('name="debounceSeconds"');
    expect(markup).toContain('min="0"');
    expect(markup).toContain('max="300"');
    expect(markup).toContain('value="30"');
    expect(markup).toContain('เหตุการณ์วิกฤตแจ้งทันที');
    expect(markup).toContain('ไม่รับเคสแทนเจ้าหน้าที่');
    expect(markup).toContain('ไม่ทำเครื่องหมายว่าอ่านแล้ว');
  });

  it('reports missing observations honestly and renders no invented wait', () => {
    const markup = html(<IncidentRulesEditor initial={{ ...saved, notifications: null }} canManage />);
    expect(markup).toContain('ยังไม่ทราบการตั้งเวลารับแจ้งเตือนเจ้าหน้าที่');
    expect(markup).not.toContain('name="debounceSeconds"');
    expect(markup).not.toContain('value="30"');
  });

  it('submits current rule and observed notification values through the production form action', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => ({
      ok: true, status: 200, json: async () => ({ revision: 8 }),
    } as Response));
    const setPending = vi.fn();
    const setMessage = vi.fn();
    const refresh = vi.fn();
    const action = createIncidentRulesSaveAction(saved, { fetcher, setPending, setMessage, refresh });

    await action(formData('75'));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      revision: 7,
      rules: { minReports: 5, minDistinctSessions: 3, windowMinutes: 15, minSimilarity: 0.85 },
      notifications: { debounceSeconds: 75 },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('calls native-style fetch without replacing its receiver with the dependency object', async () => {
    const fetcher = vi.fn<typeof fetch>(async function(this: unknown) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return new Response(JSON.stringify({ revision: 8 }), { status: 200 });
    });
    const refresh = vi.fn();
    const setMessage = vi.fn();
    await createIncidentRulesSaveAction(saved, { fetcher, setPending: vi.fn(), setMessage, refresh })(formData('17'));
    expect(refresh).toHaveBeenCalledOnce();
    expect(setMessage).toHaveBeenCalledWith('บันทึกกติกาแล้ว');
  });

  it('omits notifications when their settings were not observed', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => ({ ok: true, status: 200, json: async () => ({ revision: 8 }) } as Response));
    const action = createIncidentRulesSaveAction({ ...saved, notifications: null }, {
      fetcher, setPending: vi.fn(), setMessage: vi.fn(), refresh: vi.fn(),
    });

    await action(formData('75'));

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).not.toHaveProperty('notifications');
  });

  it('blocks invalid observed values before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const setMessage = vi.fn();
    const action = createIncidentRulesSaveAction(saved, {
      fetcher, setPending: vi.fn(), setMessage, refresh: vi.fn(),
    });

    await action(formData('30.5'));

    expect(fetcher).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining('0 ถึง 300'));
  });

  it('keeps the form draft available after a revision conflict', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) } as Response));
    const setMessage = vi.fn();
    const refresh = vi.fn();
    const draft = formData('75');
    const action = createIncidentRulesSaveAction(saved, {
      fetcher, setPending: vi.fn(), setMessage, refresh,
    });

    await action(draft);

    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining('โหลดข้อมูลล่าสุด'));
    expect(refresh).not.toHaveBeenCalled();
    expect(draft.get('debounceSeconds')).toBe('75');
  });
});
