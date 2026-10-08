import '../../incidents.css';
import { requireStaff } from '@/lib/auth/staff';
import { listIncidents, listIncidentDepartments } from '@/lib/incidents/reads';
import IncidentListView from './IncidentListView';
import { parseIncidentSearchParams, type IncidentSearchParams } from './presentation';

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<IncidentSearchParams> }) {
  const staff = await requireStaff();
  const raw = await searchParams;
  let query: ReturnType<typeof parseIncidentSearchParams> = { page: 1, pageSize: 25 };
  let result;
  let error = false;
  let departments: {id:string;name:string}[] | undefined;
  try { departments = await listIncidentDepartments(staff.id); } catch { /* The result remains usable when filter choices cannot be loaded. */ }
  try {
    query = parseIncidentSearchParams(raw);
  } catch {
    error = true;
  }
  if (!error) {
    try { result = await listIncidents(staff.id, query); } catch { error = true; }
  }
  return <IncidentListView query={query} result={result} error={error} departments={departments} />;
}
