import {installShutdownBridge} from '../../scripts/local/node-service.mjs';
installShutdownBridge();
let timer;
process.on('message',message=>{if(message?.type==='ping')process.send({type:'pong'});});
process.send({type:'ready'});
// Deliberately attach after readiness so the stop-before-handler race is real.
setTimeout(()=>{
 const heartbeat=setInterval(()=>{},100);
 process.once('SIGTERM',()=>{
  clearInterval(heartbeat);clearTimeout(timer);
  timer=setTimeout(()=>{process.send({type:'closed'});process.disconnect();},30);
 });
},100);
