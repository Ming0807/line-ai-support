import {z} from 'zod';
export const availabilityDatasets=['academic_calendar_events','tuition_fees','transfer_courses','university_services','university_systems','service_forms','announcements'] as const;
export const structuredAvailabilitySchema=z.strictObject({available:z.boolean(),datasets:z.array(z.enum(availabilityDatasets)).max(7),registryVersion:z.literal('structured-v1')}).refine(value=>value.available?value.datasets.length===7&&new Set(value.datasets).size===7:value.datasets.length===0);
