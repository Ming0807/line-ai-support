import { z } from 'zod';

export const staffAlertSettingsSchema = z.strictObject({
  debounceSeconds: z.number().int().min(0).max(300),
});

export type StaffAlertSettings = z.infer<typeof staffAlertSettingsSchema>;
