import type {SourceLocation} from '../../lib/imports/types';
export const knowledgeLocations:SourceLocation[]=[
 {kind:'PDF',pageNumber:12,blockStart:2,blockEnd:3,tableIndex:1},
 {kind:'DOCX',blockStart:2,blockEnd:3,headingPath:['ข้อ 5'],tableIndex:null},
 {kind:'XLSX',sheetName:'ค่าธรรมเนียม',sheetIndex:1,rowStart:2,rowEnd:3,columnStart:1,columnEnd:2,tableIndex:1},
 {kind:'CSV',rowStart:2,rowEnd:3,columnStart:1,columnEnd:2,tableIndex:1},
 {kind:'HTML',sourceUrl:'https://fixture.yru.ac.th/rules',blockStart:2,blockEnd:3,headingPath:['ข้อ 5'],tableIndex:null},
];
