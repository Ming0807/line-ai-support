import { describe, expect, it } from 'vitest';
import { staffAlertSettingsSchema } from '@/lib/incidents/staff-alert-contracts';

describe('staff alert settings contract', () => {
  it('accepts only integer waits from zero through five minutes', () => {
    expect(staffAlertSettingsSchema.parse({ debounceSeconds: 0 })).toEqual({ debounceSeconds: 0 });
    expect(staffAlertSettingsSchema.parse({ debounceSeconds: 30 })).toEqual({ debounceSeconds: 30 });
    expect(staffAlertSettingsSchema.parse({ debounceSeconds: 300 })).toEqual({ debounceSeconds: 300 });
  });

  it('rejects extra fields, non-finite values, fractions, null, and values outside the bound', () => {
    for (const value of [
      { debounceSeconds: 30, enabled: true },
      { debounceSeconds: Number.NaN },
      { debounceSeconds: Number.POSITIVE_INFINITY },
      { debounceSeconds: Number.NEGATIVE_INFINITY },
      { debounceSeconds: 30.5 },
      { debounceSeconds: -1 },
      { debounceSeconds: 301 },
      null,
    ]) expect(staffAlertSettingsSchema.safeParse(value).success).toBe(false);
  });
});
