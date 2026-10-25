import type {AIErrorCode,AIModelConfig} from './types';

export interface TurnAttempt {finish(error?:AIErrorCode):void|Promise<void>}
export interface TurnBudget {
 readonly used:number;
 canAttempt(model:AIModelConfig):boolean|Promise<boolean>;
 reserve(model:AIModelConfig):TurnAttempt|null|Promise<TurnAttempt|null>;
}
/** Process-local component for an owned turn. Production queue replay needs durable reservation;
 * never create one global instance or claim this alone persists across INBOX/AI workers. */
export function createTurnBudget({limit}:{limit:number}):{readonly used:number;canAttempt(model:AIModelConfig):boolean;reserve(model:AIModelConfig):TurnAttempt|null} {
 if(!Number.isInteger(limit)||limit<1||limit>4)throw new Error('TURN_BUDGET_INVALID');
 let used=0;
 const pending=new Set<string>(),failed=new Set<string>();
 const identity=(model:AIModelConfig)=>JSON.stringify([model.providerId,model.id,model.providerRevision,model.modelRevision,
  model.providerNetworkRevision??null,model.modelNetworkRevision??null]);
 const canAttempt=(model:AIModelConfig)=>used<limit&&!pending.has(identity(model))&&!failed.has(identity(model));
 return {get used(){return used;},canAttempt,reserve(model){
  if(!canAttempt(model))return null;
  const id=identity(model);used++;pending.add(id);let finished=false;
  return {finish(error){if(finished)return;finished=true;pending.delete(id);if(error)failed.add(id);}};
 }};
}
