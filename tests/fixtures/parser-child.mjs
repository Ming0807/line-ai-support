// Trusted subprocess fixture. Behaviors come only from test-controlled stdin, never runtime uploads.
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const input=Buffer.concat(chunks),mode=JSON.parse(input.toString('utf8')).mode;
if(mode==='env')process.stdout.write(JSON.stringify({keys:Object.keys(process.env),heap:process.execArgv.includes('--max-old-space-size=256'),bytes:input.length}));
else if(mode==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
else if(mode==='output')process.stdout.write(Buffer.alloc(32*1024*1024+1,65));
else if(mode==='stderr'){process.stderr.write(Buffer.alloc(65537,65));setInterval(()=>{},1000);}
else if(mode==='fail'){process.stderr.write('PRIVATE_UPLOADED_CONTENT_AND_STACK');process.exitCode=1;}
else if(mode==='utf8')process.stdout.write(Buffer.from([0xff]));
else if(mode==='closed')process.stdout.write('{}');
else process.exitCode=2;
