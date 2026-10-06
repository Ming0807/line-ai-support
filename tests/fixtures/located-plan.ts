import {createImportSource} from '../../lib/imports/source';
import {parseHtmlSource} from '../../lib/imports/html-parser';
import {buildLocatedChunkPlan} from '../../lib/knowledge/located-chunk-plan';
import {LOCAL_EMBEDDING_MODEL,LOCAL_EMBEDDING_REVISION,LOCAL_EMBEDDING_FINGERPRINT} from '../../lib/knowledge/embedding-space';
import type {PassageTokenCounter} from '../../lib/knowledge/embedding-client';
export async function locatedPlanFixture(){
 const source=createImportSource({bytes:new TextEncoder().encode('<html><h1>บริการมหาวิทยาลัย</h1><p>ขั้นตอนการใช้งานห้องสมุด</p><table><tr><td>บริการ</td><td></td></tr><tr><td>ห้องสมุด</td><td>001.20</td></tr></table></html>'),filename:'review.html',mimeType:'text/html',sourceUrl:'https://www.yru.ac.th/services',acquiredFrom:'UPLOAD',fetchedAt:null});
 const extraction=parseHtmlSource(source);
 const counter:PassageTokenCounter={modelId:LOCAL_EMBEDDING_MODEL,revision:LOCAL_EMBEDDING_REVISION,dimension:384,fingerprint:LOCAL_EMBEDDING_FINGERPRINT,countPassageTokens:async texts=>texts.map(()=>30)};
 const plan=await buildLocatedChunkPlan(source,extraction,{jobId:'123e4567-e89b-42d3-a456-426614174000',extractionRevision:2},counter);
 return {source,extraction,plan,counter};
}
