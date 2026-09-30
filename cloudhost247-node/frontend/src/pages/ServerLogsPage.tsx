import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

interface JobLog {
  id: string;
  status: string;
  operation: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  logs: Array<{ at: string;level: string;stage: string;message: string }>;
}

export default function ServerLogsPage(){
  const {id=''}=useParams();usePageMeta('Provisioning logs','Server provisioning activity.');
  const [jobs,setJobs]=useState<JobLog[]|null>(null);const [error,setError]=useState('');
  useEffect(()=>{apiFetch<{jobs:JobLog[]}>(`/api/v1/servers/${id}/logs`).then((result)=>setJobs(result.jobs)).catch((cause:Error)=>setError(cause.message));},[id]);
  return <div className="ch247-stack"><section className="ch247-card"><Link to={`/dashboard/servers/${id}`}>← Back to server</Link><h1>Provisioning logs</h1><p className="ch247-page__hint">Provider secrets and sensitive request payloads are never included.</p></section>
    {error&&<CatalogErrorBanner message={error}/>} {!jobs&&!error&&<CatalogLoadingBanner label="Loading logs…"/>}
    {jobs?.map((job)=><section className="ch247-card" key={job.id}><div className="ch247-section-heading"><h2>{job.operation} · {job.status}</h2><span>{new Date(job.created_at).toLocaleString()}</span></div>{job.error_message&&<p className="ch247-banner ch247-banner--error">{job.error_code}: {job.error_message}</p>}<div className="ch247-console">{job.logs.map((entry,index)=><div className={`ch247-console__line is-${entry.level}`} key={`${entry.at}-${index}`}><span className="ch247-console__time">{new Date(entry.at).toLocaleTimeString()}</span>{entry.stage} — {entry.message}</div>)}</div></section>)}
    {jobs?.length===0&&<section className="ch247-card"><p>No provisioning jobs exist for this server yet.</p></section>}
  </div>;
}
