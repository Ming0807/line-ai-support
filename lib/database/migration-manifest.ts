/** Collect only the reviewed application's qualified table names. */
export function applicationTables(sql:string):string[] {
 return [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?(public|private)"?\s*\.\s*"?(\w+)"?/gi)]
  .map(match=>`${match[1]}.${match[2]}`.toLowerCase());
}
