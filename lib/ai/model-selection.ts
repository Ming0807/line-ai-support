export const MODEL_REGISTRY_LIMIT=64;
export function isModelCoolingDown(model:{cooldownUntil?:string|null},now=Date.now()):boolean {
 return typeof model.cooldownUntil==='string'&&Date.parse(model.cooldownUntil)>now;
}
export function compareModelPriority(a:{id:string;providerPriority:number;priority:number},b:{id:string;providerPriority:number;priority:number}):number {
 return a.providerPriority-b.providerPriority||a.priority-b.priority||a.id.localeCompare(b.id);
}
export function supportsGeneration(model:{supportsJson:boolean;supportsTools:boolean},requiresTools:boolean):boolean {
 return model.supportsJson&&(!requiresTools||model.supportsTools);
}
