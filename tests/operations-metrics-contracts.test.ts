import {expect,it} from 'vitest';
import {parseMetricQuery,parseUsageQuery,summarySchema,usageSchema,analyticsSchema} from '../lib/operations/metrics-contracts';
const now=new Date('2026-10-07T18:00:00Z');
it('accepts only bounded date windows and a narrowing UUID department',()=>{
 expect(parseMetricQuery(new URLSearchParams(),now)).toEqual({from:'2026-10-02',to:'2026-10-08'});
 expect(parseMetricQuery(new URLSearchParams('department=39f7e07f-7d76-433e-a83e-205297c60a83'),now).department).toBe('39f7e07f-7d76-433e-a83e-205297c60a83');
 for(const query of ['page=1','q=secret','department=dept-123','department=x&department=y','from=2026-02-30','from=2026-01-01&to=2026-05-01'])expect(()=>parseMetricQuery(new URLSearchParams(query),now)).toThrow();
 expect(()=>parseUsageQuery(new URLSearchParams('department=39f7e07f-7d76-433e-a83e-205297c60a83'),now)).toThrow();
});
it('rejects incomplete or inconsistent metrics instead of inventing empty successes',()=>{
 expect(summarySchema.safeParse({counts:{open:0}}).success).toBe(false);
 expect(usageSchema.safeParse({totals:{calls:0},models:[]}).success).toBe(false);
 expect(analyticsSchema.safeParse({resolution:{samples:0,averageSeconds:0}}).success).toBe(false);
});
