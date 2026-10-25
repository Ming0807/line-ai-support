import {spawn} from 'node:child_process';

const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
process.send({type:'ready',descendantPid:descendant.pid});
