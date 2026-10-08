import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({staff:vi.fn(),metrics:vi.fn(),embedding:vi.fn(),binding:vi.fn()}));
vi.mock('@/lib/auth/staff',()=>({requireStaff:m.staff}));
vi.mock('@/lib/operations/metrics',()=>({readOperationsSettings:m.metrics}));
vi.mock('@/lib/knowledge/embedding-status',()=>({getEmbeddingStatus:m.embedding}));
vi.mock('@/lib/staff/line-binding',()=>({getBindingStatus:m.binding}));
import SettingsPage from '@/app/(dashboard)/settings/page';
beforeEach(()=>{vi.resetAllMocks();m.staff.mockResolvedValue({id:'actor',role:'STAFF'});m.binding.mockResolvedValue({bound:false,pending:false,expiresAt:null});m.metrics.mockRejectedValue(Error('private'));m.embedding.mockResolvedValue(null);});
it('makes self Settings available to staff without querying administrative health or configuration',async()=>{
 const html=renderToStaticMarkup(await SettingsPage());expect(html).toContain('เชื่อมต่อ LINE เจ้าหน้าที่');expect(html).not.toContain('Worker liveness');expect(m.metrics).not.toHaveBeenCalled();expect(m.embedding).not.toHaveBeenCalled();expect(m.binding).toHaveBeenCalledWith('actor');
});
it('retains administrative observations only for Super Admin',async()=>{
 m.staff.mockResolvedValue({id:'actor',role:'SUPER_ADMIN'});const html=renderToStaticMarkup(await SettingsPage());expect(html).toContain('เชื่อมต่อ LINE เจ้าหน้าที่');expect(m.metrics).toHaveBeenCalledWith('actor');expect(m.embedding).toHaveBeenCalledWith('actor');
});
it('shows an honest unavailable self binding without private error details',async()=>{
 m.binding.mockRejectedValue(Error('private credentials'));const html=renderToStaticMarkup(await SettingsPage());expect(html).toContain('ตรวจสอบการเชื่อมต่อไม่สำเร็จ');expect(html).not.toContain('private credentials');
});
