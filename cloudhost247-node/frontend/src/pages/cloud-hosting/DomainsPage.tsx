import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { SearchBar } from '../../components/SearchBar';
import { FilterBar } from '../../components/FilterBar';

export default function CloudHostingDomainsPage() {
  usePageMeta('Domain Manager', 'Manage your domains and SSL certificates with Dokploy.');

  const { user } = useAuthenticatedUser();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await CloudHostingService.getDomains(user.id, searchQuery, filters);
        setDomains(result);
      } catch (err) {
        setError(err.message || 'Failed to load domains');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.id, searchQuery, filters]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="cloud-hosting-domains">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>Domain Manager</h1>
          <p>Manage your domains and SSL certificates with Dokploy.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <div className="ch247-action-bar">
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search domains..." />
            <FilterBar filters={filters} onChange={setFilters} />
            <Button to="/dashboard/cloud-hosting/domains/add" variant="primary">Connect Domain</Button>
          </div>

          <Table 
            columns={[
              { key: 'domain', label: 'Domain', sortable: true },
              { key: 'status', label: 'Status', sortable: true },
              { key: 'ssl', label: 'SSL', sortable: true },
              { key: 'application', label: 'Application', sortable: false },
              { key: 'expiration', label: 'Expiration', sortable: true },
              { key: 'actions', label: 'Actions', sortable: false }
            ]}
            data={domains}
            rowKey="id"
            renderCell={(column, row) => {
              switch (column.key) {
                case 'actions':
                  return (
                    <div className="action-buttons">
                      <Button size="small" variant="secondary" to={`/dashboard/cloud-hosting/domains/${row.id}`}>View</Button>
                      <Button size="small" variant="secondary" onClick={() => handleSSL(row.id)}>SSL</Button>
                      <Button size="small" variant="danger" onClick={() => handleDelete(row.id)}>Delete</Button>
                    </div>
                  );
                case 'status':
                  return <span className={`status-${row.status}`}>{row.status}</span>;
                case 'ssl':
                  return <span className={`ssl-${row.ssl}`}>{row.ssl}</span>;
                default:
                  return row[column.key];
              }
            }}
          />
        </div>
      </section>
    </div>
  );
}

interface Domain {
  id: string;
  domain: string;
  status: 'active' | 'pending' | 'expired' | 'failed';
  ssl: 'valid' | 'expiring' | 'invalid' | 'none';
  application: string;
  expiration: string;
}

interface FilterOptions {
  status?: 'active' | 'pending' | 'expired' | 'failed';
  ssl?: 'valid' | 'expiring' | 'invalid' | 'none';
}

const handleSSL = async (domainId: string) => {
  // Implementation for SSL management via Dokploy API
};

const handleDelete = async (domainId: string) => {
  // Implementation for domain deletion via Dokploy API
};
