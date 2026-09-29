/** Small, inspectable demo source snapshots. These are not fetched from real users. */
export const portAuthoritySource: Record<string, string> = {
  'src/App.tsx': `import React, { useEffect, useState } from 'react';
import { inspectListeners, killProcess } from './services';
export default function App() {
 const [services,setServices] = useState([]);
 const [query,setQuery] = useState('');
 useEffect(() => {
   async function refreshPorts(){ setServices(await inspectListeners()); }
   refreshPorts();
   const timer = setInterval(refreshPorts, 3000);
   return () => clearInterval(timer);
 }, []);
 return <main><h1>Port Authority</h1>
   <input placeholder="Search services by port or process" value={query} onChange={e=>setQuery(e.target.value)}/>
   {services.filter(service=>String(service.port).includes(query)||service.command.includes(query)).map(service=><article key={service.pid}>
    <span>{service.port} {service.pid} {service.command}</span>
    <button onClick={()=>killProcess(service.pid)}>Kill process</button>
    <button onClick={()=>window.open('http://localhost:'+service.port,'_blank')}>Open in browser</button>
   </article>)}
 </main>;
}`,
  'src/services.ts': `export async function inspectListeners(){const response=await fetch('/api/ports');return response.json();}
export async function killProcess(pid){await fetch('/api/kill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pid})});}`,
  'server/routes.ts': `import express from 'express';
import { execFile } from 'node:child_process';
const app=express();
app.use(express.json());
app.get('/api/ports', (_req,res)=>{
 execFile('lsof',['-nP','-iTCP','-sTCP:LISTEN','-Fpcn'],(error,output)=>{
   if(error&& !output)return res.status(500).json({error:'Could not inspect local listeners'});
   const listeners=[];let current={};
   for(const line of output.split('\\n')){
    if(line.startsWith('p'))current={pid:Number(line.slice(1))};
    if(line.startsWith('c'))current.command=line.slice(1);
    if(line.startsWith('n'))listeners.push({...current,address:line.slice(1),port:Number(line.split(':').pop())});
   }
   res.json(listeners);
 });
});
app.post('/api/kill',(req,res)=>{
 const pid=Number(req.body.pid);
 if(!Number.isInteger(pid)||pid<=1)return res.status(400).json({error:'Invalid PID'});
 process.kill(pid,'SIGTERM');res.json({stopped:true});
});`,
  'src/config.ts': `export const port = process.env.PORT;`,
  '.env.example': 'PORT=3000\n',
};
