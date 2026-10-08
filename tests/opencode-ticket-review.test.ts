import {beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const mocks=vi.hoisted(()=>({staff:vi.fn(),list:vi.fn()}));
vi.mock('@/lib/auth/staff',()=>({requireStaff:mocks.staff}));
vi.mock('@/lib/tickets/reads',()=>({listTickets:mocks.list}));
import TicketsPage from '@/app/(dashboard)/tickets/page';
import {parseCanonicalTicketQuery} from '@/app/(dashboard)/tickets/ticket-helpers';

const empty={tickets:[],departments:[],assignees:[]};
async function html(params:Record<string,string>={}){
 return renderToStaticMarkup(await TicketsPage({searchParams:Promise.resolve(params)}));
}
beforeEach(()=>{vi.resetAllMocks();mocks.staff.mockResolvedValue({id:'test-staff'});mocks.list.mockResolvedValue(empty);});
describe('OC-UI-01R root rendered-page regressions',()=>{
 it('does not claim no matches from an empty response without pagination',async()=>{
  const result=await html({q:'ปฏิทิน'});
  expect(result).toContain('ยังไม่ทราบผลการค้นหา');
  expect(result).not.toContain('ไม่พบรายการที่ตรงกับคำค้นหา');
 });
 it('uses unknown state for malformed or mismatched pagination',async()=>{
  for(const pagination of [{total:0},{page:1,pageSize:100,total:0,totalPages:1,hasNext:false,hasPrevious:false},
   {page:2,pageSize:100,total:0,totalPages:0,hasNext:false,hasPrevious:true},
   {page:1,pageSize:100,total:250,totalPages:3,hasNext:true,hasPrevious:false}]){
   mocks.list.mockResolvedValueOnce({...empty,pagination});
   expect(await html()).toContain('ยังไม่ทราบผลการค้นหา');
  }
 });
 it('keeps known zero matches distinct from missing pagination',async()=>{
  mocks.list.mockResolvedValueOnce({...empty,pagination:{page:1,pageSize:100,total:0,totalPages:0,hasNext:false,hasPrevious:false}});
  const result=await html({q:'ปฏิทิน'});
  expect(result).toContain('ไม่พบรายการที่ตรงกับคำค้นหา');
  expect(result).not.toContain('ยังไม่ทราบผลการค้นหา');
 });
 it('does not clamp an out-of-range page or display an inverted range',async()=>{
  mocks.list.mockResolvedValueOnce({...empty,pagination:{page:11,pageSize:25,total:250,totalPages:10,hasNext:false,hasPrevious:true}});
  const result=await html({q:'ปฏิทิน',page:'11',pageSize:'25'});
  expect(mocks.list).toHaveBeenCalledWith('test-staff',{q:'ปฏิทิน',page:11,pageSize:25});
  expect(result).toContain('หน้านี้ไม่มีรายการ');
  expect(result).not.toContain('251 - 250');
  expect(result).toContain('page=10');
 });
 it('rejects present empty page/pageSize without a service call',async()=>{
  for(const key of ['page','pageSize']){
   expect(parseCanonicalTicketQuery({[key]:''}).validationError).toBeTruthy();
   await html({[key]:''});
  }
  expect(mocks.list).not.toHaveBeenCalled();
 });
 it('uses the Root UUID grammar rather than arbitrary hex groups',()=>{
  expect(parseCanonicalTicketQuery({department:'11111111-1111-1111-1111-111111111111'}).validationError).toBeTruthy();
  expect(parseCanonicalTicketQuery({department:'11111111-1111-4111-8111-111111111111'}).validationError).toBeUndefined();
 });
 it('retains a custom valid size in the rendered select and reset links',async()=>{
  const result=await html({q:'ปฏิทิน',pageSize:'7'});
  expect(result).toMatch(/<option value="7" selected=""/u);
  expect(result).toContain('href="/tickets?pageSize=7"');
 });
 it('forwards literal wildcard and injection-shaped search without local replacement',async()=>{
  const q="ทุน %_! ' OR 1=1";
  await html({q,pageSize:'25'});
  expect(mocks.list).toHaveBeenCalledWith('test-staff',{q,page:1,pageSize:25});
 });
});
