/** Browser-only DTOs. LINE subjects/tokens and authorization grants never appear here. */
export type StaffApplicationStatus='PENDING'|'APPROVED'|'REJECTED'|'SUSPENDED';
export interface StaffApplicationItem {
 id:string;applicantName:string;staffCode:string;requestedDepartmentId:string;requestedDepartmentName:string;
 approvedDepartmentId:string|null;approvedDepartmentName:string|null;status:StaffApplicationStatus;
 revision:number;submittedAt:string;reviewedAt:string|null;reviewerName:string|null;decisionReason:string|null;
}
export interface StaffApplicationContext {
 authenticated:boolean;lineLinked:boolean;staffActive:boolean;loginAvailable:boolean;canReview:boolean;
 application:StaffApplicationItem|null;departments:{id:string;name:string}[];
}
export interface StaffApplicationList {
 items:StaffApplicationItem[];departments:{id:string;name:string}[];
 pagination:{page:number;pageSize:number;total:number;totalPages:number;hasNext:boolean;hasPrevious:boolean};
}
export interface SubmitStaffApplication {applicantName:string;staffCode:string;departmentId:string;requestId:string}
export interface DecideStaffApplication {decision:'APPROVE'|'REJECT';departmentId?:string;reason?:string;revision:number;requestId:string}
export interface SuspendStaffApplication {reason:string;revision:number;requestId:string}
