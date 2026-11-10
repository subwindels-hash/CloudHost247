import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { SearchBar } from '../../components/SearchBar';
import { FilterBar } from '../../components/FilterBar';

export default function CloudHostingBackupsPage() {
  usePageMeta('Backup Manager', 'Manage backups and restoration with Dokploy.');

  const { user } = useAuthenticatedUser();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await CloudHostingService.getBackups(user.id, searchQuery, filters);
        setBackups(result);
      } catch (err) {
        setError(err.message || 'Failed to load backups');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.id, searchQuery, filters]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="cloud-hosting-backups">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>Backup Manager</h1>
          <p>Manage backups and restoration with Dokploy.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <div className="ch247-action-bar">
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search backups..." />
            <FilterBar filters={filters} onChange={setFilters} />
            <Button to="/dashboard/cloud-hosting/backups/create" variant="primary">Create Backup</Button>
          </div>

          <Table 
            columns={[
              { key: 'name', label: 'Backup Name', sortable: true },
              { key: 'resource', label: 'Resource', sortable: true },
              { key: 'type', label: 'Type', sortable: true },
              { key: 'date', label: 'Date', sortable: true },
              { key: 'size', label: 'Size', sortable: true },
              { key: 'status', label: 'Status', sortable: true },
              { key: 'actions', label: 'Actions', sortable: false }
            ]}
            data={backups}
            rowKey="id"
            renderCell={(column, row) => {
              switch (column.key) {
                case 'actions':
                  return (
                    <div className="action-buttons">
                      <Button size="small" variant="secondary" to={`/dashboard/cloud-hosting/backups/${row.id}`}>View</Button>
                      <Button size="small" variant="secondary" onClick={() => handleRestore(row.id)}>Restore</Button>
                      <Button size="small" variant="danger" onClick={() => handleDelete(row.id)}>Delete</Button>
                    </div>
                  );
                case 'status':
                  return <span className={`status-${row.status}`}>{row.status}</span>;
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

interface Backup {
  id: string;
  name: string;
  resource: string;
  type: 'database' | 'application' | 'full';
  date: string;
  size: string;
  status: 'success' | 'failed' | 'pending' | 'restoring';
}

interface FilterOptions {
  type?: 'database' | 'application' | 'full';
  status?: 'success' | 'failed' | 'pending' | 'restoring';
}

const handleRestore = async (backupId: string) => {
  // Implementation for backup restoration via Dokploy API
};

const handleDelete = async (backupId: string) => {
  // Implementation for backup deletion via Dokploy API
};
