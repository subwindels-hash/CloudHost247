import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import InfrastructureNav from '../components/InfrastructureNav';
import StatusBadge from '../components/StatusBadge';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

interface OsRow {
  id:string;name:string;slug:string;os_release_ids:string[];vendor:string|null;description:string|null;
  logo_url:string|null;status:'ACTIVE'|'DISABLED'|'ARCHIVED';sort_order:number;is_vps_supported:boolean;
  is_dedicated_supported:boolean;is_cloud_supported:boolean;is_reinstall_supported:boolean;
}

const MAX_LOGO_BYTES=512*1024;

async function fileBase64(file:File):Promise<string>{
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary='';
  for(let index=0;index<bytes.length;index+=1)binary+=String.fromCharCode(bytes[index]!);
  return btoa(binary);
}

export default function AdminOperatingSystemsPage(){
  usePageMeta('Operating systems','Admin — OS catalog and lifecycle.');
  const [rows,setRows]=useState<OsRow[]|null>(null);
  const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [showCreate,setShowCreate]=useState(false);const [editing,setEditing]=useState<OsRow|null>(null);
  const [busy,setBusy]=useState('');
  const [form,setForm]=useState({name:'',slug:'',osReleaseIds:'',vendor:'',description:'',logoUrl:'',sortOrder:'0',isVpsSupported:true,isDedicatedSupported:true,isCloudSupported:true,isReinstallSupported:true});
  const load=useCallback(()=>apiFetch<{operatingSystems:OsRow[]}>('/api/v1/admin/operating-systems').then((result)=>setRows(result.operatingSystems)).catch((cause:Error)=>setError(cause.message)),[]);
  useEffect(()=>{void load();},[load]);

  async function create(event:FormEvent){
    event.preventDefault();setError('');
    try{
      const body={...form,osReleaseIds:form.osReleaseIds.split(',').map((item)=>item.trim()).filter(Boolean),sortOrder:Number(form.sortOrder)};
      if(editing){
        const{slug:_,...patchBody}=body;void _;
        await apiFetch(`/api/v1/admin/operating-systems/${editing.id}`,{method:'PATCH',body:JSON.stringify(patchBody)});
        setMessage('Operating system details updated.');
      }else{
        await apiFetch('/api/v1/admin/operating-systems',{method:'POST',body:JSON.stringify({...body,status:'DISABLED'})});
        setMessage('Operating system created disabled. Add versions and verified images before enabling it.');
      }
      setShowCreate(false);setEditing(null);await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'Save failed');}
  }
  function edit(row:OsRow){
    setEditing(row);setShowCreate(true);
    setForm({name:row.name,slug:row.slug,osReleaseIds:row.os_release_ids.join(', '),vendor:row.vendor??'',description:row.description??'',logoUrl:row.logo_url??'',sortOrder:String(row.sort_order),isVpsSupported:row.is_vps_supported,isDedicatedSupported:row.is_dedicated_supported,isCloudSupported:row.is_cloud_supported,isReinstallSupported:row.is_reinstall_supported});
  }
  async function patch(row:OsRow,body:Record<string,unknown>){
    setError('');setBusy(row.id);
    try{await apiFetch(`/api/v1/admin/operating-systems/${row.id}`,{method:'PATCH',body:JSON.stringify(body)});setMessage(`${row.name} updated.`);await load();}
    catch(cause){setError(cause instanceof Error?cause.message:'Update failed');}finally{setBusy('');}
  }
  async function uploadLogo(row:OsRow,event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Choose a PNG, JPEG or WebP logo.');return;}
    if(file.size>MAX_LOGO_BYTES){setError('Logo must be 512 KiB or smaller.');return;}
    setError('');setBusy(row.id);
    try{
      await apiFetch(`/api/v1/admin/operating-systems/${row.id}/logo`,{method:'POST',body:JSON.stringify({fileName:file.name,contentType:file.type,contentBase64:await fileBase64(file)})});
      setMessage(`${row.name} logo uploaded.`);await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'Logo upload failed');}finally{setBusy('');}
  }
  async function deleteLogo(row:OsRow){
    if(!window.confirm(`Delete the uploaded logo for ${row.name}?`))return;
    setBusy(row.id);setError('');
    try{await apiFetch(`/api/v1/admin/operating-systems/${row.id}/logo`,{method:'DELETE'});setMessage(`${row.name} logo deleted.`);await load();}
    catch(cause){setError(cause instanceof Error?cause.message:'Logo deletion failed');}finally{setBusy('');}
  }
  async function remove(row:OsRow){
    if(!window.confirm(`Permanently delete archived OS ${row.name}? This works only when no versions or servers reference it.`))return;
    setBusy(row.id);setError('');
    try{await apiFetch(`/api/v1/admin/operating-systems/${row.id}`,{method:'DELETE'});setMessage(`${row.name} deleted.`);await load();}
    catch(cause){setError(cause instanceof Error?cause.message:'Delete failed');}finally{setBusy('');}
  }

  return <div className="ch247-stack">
    <section className="ch247-card ch247-section-heading"><div><span className="ch247-eyebrow">Admin · Infrastructure</span><h1>Operating systems</h1><p className="ch247-page__hint">Catalog records are separate from deployable provider images. Enabling an OS alone never makes an image deployable.</p></div><button className="ch247-btn ch247-btn--primary" onClick={()=>{setShowCreate((current)=>!current);setEditing(null);}}>{showCreate?'Close':'Add operating system'}</button></section>
    <InfrastructureNav active="operating-systems"/>
    {error&&<CatalogErrorBanner message={error}/>} {message&&<p className="ch247-banner ch247-banner--info">{message}</p>}
    {showCreate&&<form className="ch247-card ch247-form" onSubmit={create}><h2>{editing?'Edit operating system':'New operating system'}</h2><div className="ch247-form-grid"><label className="ch247-field">Name<input required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></label><label className="ch247-field">Slug<input required disabled={Boolean(editing)} value={form.slug} onChange={(e)=>setForm({...form,slug:e.target.value.toLowerCase()})}/></label><label className="ch247-field">os-release IDs<input required value={form.osReleaseIds} onChange={(e)=>setForm({...form,osReleaseIds:e.target.value.toLowerCase()})} placeholder="ubuntu (comma-separated)"/><small>Accepted ID values from /etc/os-release for health attestation.</small></label><label className="ch247-field">Vendor<input value={form.vendor} onChange={(e)=>setForm({...form,vendor:e.target.value})}/></label><label className="ch247-field">Static logo URL<input value={form.logoUrl} onChange={(e)=>setForm({...form,logoUrl:e.target.value})} placeholder="/os-logos/distribution.svg"/><small>Or upload a database-managed logo from the table after saving.</small></label><label className="ch247-field">Sort order<input type="number" value={form.sortOrder} onChange={(e)=>setForm({...form,sortOrder:e.target.value})}/></label></div><label className="ch247-field">Description<textarea value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}/></label><div className="ch247-fieldset">{([['isVpsSupported','VPS'],['isDedicatedSupported','Dedicated'],['isCloudSupported','Cloud'],['isReinstallSupported','Reinstall']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.checked})}/>{label}</label>)}</div><button className="ch247-btn ch247-btn--primary">{editing?'Save changes':'Create disabled'}</button></form>}
    {!rows&&!error&&<CatalogLoadingBanner label="Loading OS catalog…"/>}
    {rows&&<section className="ch247-card"><div className="ch247-table-wrap"><table className="ch247-table"><thead><tr><th>Operating system</th><th>Status</th><th>Products</th><th>Order</th><th>Actions</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><div className="ch247-os-table-name">{row.logo_url?<img src={row.logo_url} alt=""/>:<span className="ch247-os-card__fallback">{row.name.slice(0,2)}</span>}<div><strong>{row.name}</strong><small>{row.vendor??row.slug}</small></div></div></td><td><StatusBadge status={row.status}/></td><td>{[row.is_vps_supported&&'VPS',row.is_cloud_supported&&'Cloud',row.is_dedicated_supported&&'Dedicated',row.is_reinstall_supported&&'Reinstall'].filter(Boolean).join(' · ')||'None'}</td><td>{row.sort_order}</td><td><div className="ch247-actions"><button className="ch247-btn" disabled={busy===row.id} onClick={()=>edit(row)}>Edit</button><Link className="ch247-btn" to={`/admin/infrastructure/operating-systems/${row.slug}/versions`}>Versions</Link><Link className="ch247-btn" to={`/admin/infrastructure/images?os=${row.id}`}>Images</Link><label className="ch247-btn">Upload logo<input hidden type="file" accept="image/png,image/jpeg,image/webp" disabled={busy===row.id} onChange={(event)=>void uploadLogo(row,event)}/></label>{row.logo_url===`/api/v1/operating-systems/${row.id}/logo`&&<button className="ch247-btn ch247-btn--danger" disabled={busy===row.id} onClick={()=>void deleteLogo(row)}>Delete logo</button>}{row.status!=='ACTIVE'&&row.status!=='ARCHIVED'&&<button className="ch247-btn" disabled={busy===row.id} onClick={()=>void patch(row,{status:'ACTIVE'})}>Enable</button>}{row.status==='ACTIVE'&&<button className="ch247-btn" disabled={busy===row.id} onClick={()=>void patch(row,{status:'DISABLED'})}>Disable</button>}{row.status!=='ARCHIVED'&&<button className="ch247-btn ch247-btn--danger" disabled={busy===row.id} onClick={()=>void patch(row,{status:'ARCHIVED'})}>Archive</button>}{row.status==='ARCHIVED'&&<button className="ch247-btn ch247-btn--danger" disabled={busy===row.id} onClick={()=>void remove(row)}>Delete</button>}</div></td></tr>)}</tbody></table></div></section>}
  </div>;
}
