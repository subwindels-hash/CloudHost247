import { useEffect, useState } from 'react';
import {
  fetchAdminControlPanels,
  patchAdminControlPanel,
  createAdminControlPanel,
  createAdminControlPanelPlan,
  patchAdminControlPanelPlan,
} from '../lib/control-panels-api';
import StatusBadge from '../components/StatusBadge';

export default function AdminControlPanelsPage() {
  const [data, setData] = useState<{ controlPanels: any[]; plans: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingPanel, setEditingPanel] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState<string | null>(null);

  const [panelForm, setPanelForm] = useState({
    name: '',
    slug: '',
    description: '',
    category: 'SERVER_PANEL',
    logoUrl: '',
    websiteUrl: '',
    documentationUrl: '',
    status: 'ACTIVE',
    installationMethod: 'SCRIPT',
    requiresLicense: false,
    licenseProvider: 'NONE',
    minimumRamMb: 1024,
    minimumCpuCores: 1,
    minimumDiskGb: 20,
    supportedOs: 'ubuntu, debian, almalinux, rocky-linux',
  });

  const [planForm, setPlanForm] = useState({
    name: '',
    description: '',
    billingCycle: 'monthly',
    price: 0,
    licenseType: 'FREE',
    includedDomains: '',
    includedAccounts: '',
  });

  function reload() {
    fetchAdminControlPanels()
      .then(setData)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    reload();
  }, []);

  function startEdit(panel: any) {
    setEditingPanel(panel);
    setShowCreate(true);
    setPanelForm({
      name: panel.name,
      slug: panel.slug,
      description: panel.description ?? '',
      category: panel.category,
      logoUrl: panel.logo_url ?? '',
      websiteUrl: panel.website_url ?? '',
      documentationUrl: panel.documentation_url ?? '',
      status: panel.status,
      installationMethod: panel.installation_method,
      requiresLicense: panel.requires_license,
      licenseProvider: panel.license_provider,
      minimumRamMb: panel.minimum_ram_mb,
      minimumCpuCores: panel.minimum_cpu_cores,
      minimumDiskGb: panel.minimum_disk_gb,
      supportedOs: panel.supported_os.join(', '),
    });
  }

  async function savePanel(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        ...panelForm,
        minimumRamMb: Number(panelForm.minimumRamMb),
        minimumCpuCores: Number(panelForm.minimumCpuCores),
        minimumDiskGb: Number(panelForm.minimumDiskGb),
        supportedOs: panelForm.supportedOs.split(',').map((s) => s.trim()).filter(Boolean),
      };

      if (editingPanel) {
        await patchAdminControlPanel(editingPanel.id, payload);
      } else {
        await createAdminControlPanel(payload);
      }
      setShowCreate(false);
      setEditingPanel(null);
      reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function savePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!showPlanModal) return;
    try {
      await createAdminControlPanelPlan({
        controlPanelId: showPlanModal,
        name: planForm.name,
        description: planForm.description || null,
        billingCycle: planForm.billingCycle,
        price: Number(planForm.price),
        licenseType: planForm.licenseType,
        includedDomains: planForm.includedDomains ? Number(planForm.includedDomains) : null,
        includedAccounts: planForm.includedAccounts ? Number(planForm.includedAccounts) : null,
        status: 'ACTIVE',
      });
      setShowPlanModal(null);
      setPlanForm({ name: '', description: '', billingCycle: 'monthly', price: 0, licenseType: 'FREE', includedDomains: '', includedAccounts: '' });
      reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function toggleStatus(panel: any) {
    const next = panel.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await patchAdminControlPanel(panel.id, { status: next });
    reload();
  }

  return (
    <div className="ch247-page">
      <header className="ch247-page__head">
        <div>
          <span className="ch247-eyebrow">Platform Administration</span>
          <h1>Control Panels & Software Plans</h1>
          <p className="ch247-page__subtitle">
            Configure available hosting control panels, PaaS engines, commercial license tiers, and hardware requirements.
          </p>
        </div>
        <button
          className="ch247-btn ch247-btn--primary"
          onClick={() => {
            setEditingPanel(null);
            setShowCreate(!showCreate);
          }}
        >
          {showCreate ? 'Close Form' : '+ Add Control Panel'}
        </button>
      </header>

      {error && <div className="ch247-banner ch247-banner--error">{error}</div>}

      {showCreate && (
        <form className="ch247-card ch247-form" onSubmit={savePanel}>
          <h2>{editingPanel ? `Edit: ${editingPanel.name}` : 'New Control Panel'}</h2>
          <div className="ch247-form-grid">
            <label className="ch247-field">
              <span>Platform Name</span>
              <input required value={panelForm.name} onChange={(e) => setPanelForm({ ...panelForm, name: e.target.value })} />
            </label>
            <label className="ch247-field">
              <span>Slug</span>
              <input required disabled={!!editingPanel} value={panelForm.slug} onChange={(e) => setPanelForm({ ...panelForm, slug: e.target.value.toLowerCase() })} />
            </label>
            <label className="ch247-field">
              <span>Category</span>
              <select value={panelForm.category} onChange={(e) => setPanelForm({ ...panelForm, category: e.target.value })}>
                <option value="SERVER_PANEL">Server Panel</option>
                <option value="APPLICATION_DEPLOYMENT_PLATFORM">Application Deployment Platform</option>
                <option value="SERVER_MANAGEMENT">Server Management</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="ch247-field">
              <span>Logo URL</span>
              <input value={panelForm.logoUrl} onChange={(e) => setPanelForm({ ...panelForm, logoUrl: e.target.value })} placeholder="/panel-logos/name.svg" />
            </label>
            <label className="ch247-field">
              <span>Website URL</span>
              <input type="url" value={panelForm.websiteUrl} onChange={(e) => setPanelForm({ ...panelForm, websiteUrl: e.target.value })} />
            </label>
            <label className="ch247-field">
              <span>Docs URL</span>
              <input type="url" value={panelForm.documentationUrl} onChange={(e) => setPanelForm({ ...panelForm, documentationUrl: e.target.value })} />
            </label>
            <label className="ch247-field">
              <span>Min. RAM (MB)</span>
              <input type="number" required value={panelForm.minimumRamMb} onChange={(e) => setPanelForm({ ...panelForm, minimumRamMb: Number(e.target.value) })} />
            </label>
            <label className="ch247-field">
              <span>Min. CPU Cores</span>
              <input type="number" required value={panelForm.minimumCpuCores} onChange={(e) => setPanelForm({ ...panelForm, minimumCpuCores: Number(e.target.value) })} />
            </label>
            <label className="ch247-field">
              <span>Min. Disk (GB)</span>
              <input type="number" required value={panelForm.minimumDiskGb} onChange={(e) => setPanelForm({ ...panelForm, minimumDiskGb: Number(e.target.value) })} />
            </label>
            <label className="ch247-field">
              <span>License Provider</span>
              <input value={panelForm.licenseProvider} onChange={(e) => setPanelForm({ ...panelForm, licenseProvider: e.target.value })} />
            </label>
          </div>

          <label className="ch247-field">
            <span>Description</span>
            <textarea value={panelForm.description} onChange={(e) => setPanelForm({ ...panelForm, description: e.target.value })} />
          </label>

          <label className="ch247-field">
            <span>Supported OS Slugs (comma separated)</span>
            <input value={panelForm.supportedOs} onChange={(e) => setPanelForm({ ...panelForm, supportedOs: e.target.value })} />
          </label>

          <div className="ch247-checkbox-row">
            <label>
              <input type="checkbox" checked={panelForm.requiresLicense} onChange={(e) => setPanelForm({ ...panelForm, requiresLicense: e.target.checked })} />
              Requires Commercial License
            </label>
          </div>

          <div className="ch247-actions">
            <button type="submit" className="ch247-btn ch247-btn--primary">
              {editingPanel ? 'Save Changes' : 'Create Platform'}
            </button>
            <button type="button" className="ch247-btn" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {showPlanModal && (
        <form className="ch247-card ch247-form" onSubmit={savePlan}>
          <h2>Add Commercial Plan / License Tier</h2>
          <div className="ch247-form-grid">
            <label className="ch247-field">
              <span>Plan Name</span>
              <input required value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} placeholder="e.g. Solo, Admin 5, Pro" />
            </label>
            <label className="ch247-field">
              <span>License Type</span>
              <input required value={planForm.licenseType} onChange={(e) => setPlanForm({ ...planForm, licenseType: e.target.value })} placeholder="FREE, SOLO, PRO" />
            </label>
            <label className="ch247-field">
              <span>Price (USD)</span>
              <input type="number" step="0.01" required value={planForm.price} onChange={(e) => setPlanForm({ ...planForm, price: Number(e.target.value) })} />
            </label>
            <label className="ch247-field">
              <span>Billing Cycle</span>
              <select value={planForm.billingCycle} onChange={(e) => setPlanForm({ ...planForm, billingCycle: e.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi_annually">Semi-Annually</option>
                <option value="annually">Annually</option>
                <option value="one_time">One Time</option>
              </select>
            </label>
            <label className="ch247-field">
              <span>Included Domains</span>
              <input type="number" value={planForm.includedDomains} onChange={(e) => setPlanForm({ ...planForm, includedDomains: e.target.value })} placeholder="Leave empty for unlimited" />
            </label>
            <label className="ch247-field">
              <span>Included Accounts</span>
              <input type="number" value={planForm.includedAccounts} onChange={(e) => setPlanForm({ ...planForm, includedAccounts: e.target.value })} placeholder="Leave empty for unlimited" />
            </label>
          </div>
          <div className="ch247-actions">
            <button type="submit" className="ch247-btn ch247-btn--primary">Save Plan</button>
            <button type="button" className="ch247-btn" onClick={() => setShowPlanModal(null)}>Cancel</button>
          </div>
        </form>
      )}

      {data && (
        <section className="ch247-card">
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Category</th>
                  <th>License</th>
                  <th>Min. Specs</th>
                  <th>Plans</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.controlPanels.map((panel) => {
                  const plans = data.plans.filter((p) => p.control_panel_id === panel.id);
                  return (
                    <tr key={panel.id}>
                      <td>
                        <div className="ch247-os-table-name">
                          {panel.logo_url ? (
                            <img src={panel.logo_url} alt="" style={{ width: 28, height: 28, borderRadius: 6 }} />
                          ) : (
                            <span className="ch247-os-card__fallback">{panel.name.slice(0, 2)}</span>
                          )}
                          <div>
                            <strong>{panel.name}</strong>
                            <small>{panel.slug}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="ch247-badge ch247-badge--category">
                          {panel.category === 'APPLICATION_DEPLOYMENT_PLATFORM' ? 'App Platform' : panel.category === 'SERVER_MANAGEMENT' ? 'Management' : 'Server Panel'}
                        </span>
                      </td>
                      <td>
                        {panel.requires_license ? (
                          <span className="ch247-tag ch247-tag--license">{panel.license_provider}</span>
                        ) : (
                          <span className="ch247-tag ch247-tag--free">Free</span>
                        )}
                      </td>
                      <td>
                        <small>{panel.minimum_cpu_cores}C · {panel.minimum_ram_mb}MB · {panel.minimum_disk_gb}GB</small>
                      </td>
                      <td>
                        <small>{plans.length} {plans.length === 1 ? 'plan' : 'plans'}</small>
                      </td>
                      <td>
                        <StatusBadge status={panel.status} />
                      </td>
                      <td>
                        <div className="ch247-actions">
                          <button className="ch247-btn ch247-btn--sm" onClick={() => startEdit(panel)}>
                            Edit
                          </button>
                          <button className="ch247-btn ch247-btn--sm" onClick={() => setShowPlanModal(panel.id)}>
                            + Plan
                          </button>
                          <button className="ch247-btn ch247-btn--sm" onClick={() => toggleStatus(panel)}>
                            {panel.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
