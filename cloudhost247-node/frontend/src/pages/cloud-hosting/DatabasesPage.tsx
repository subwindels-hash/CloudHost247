import { usePageMeta } from '../../lib/usePageMeta';
import { useAuthenticatedUser } from '../../hooks/useAuthenticatedUser';
import { CloudHostingService } from '../../services/cloud-hosting';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { ErrorBoundary } from '../../components/AppErrorBoundary';
import { Button } from '../../components/Button';
import { Table } from '../../components/Table';
import { SearchBar } from '../../components/SearchBar';
import { FilterBar } from '../../components/FilterBar';

export default function CloudHostingDatabasesPage() {
  usePageMeta('Database Manager', 'Manage your databases with Dokploy.');

  const { user } = useAuthenticatedUser();
  const [databases, setDatabases] = useState<Database[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await CloudHostingService.getDatabases(user.id, searchQuery, filters);
        setDatabases(result);
      } catch (err) {
        setError(err.message || 'Failed to load databases');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.id, searchQuery, filters]);

  if (loading) return <LoadingSpinner />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="cloud-hosting-databases">
      <section className="ch247-hero ch247-hero--compact ch247-hero--photo ch247-hero--developers">
        <div className="ch247-hero__inner">
          <h1>Database Manager</h1>
          <p>Manage your databases with Dokploy.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          <div className="ch247-action-bar">
            <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search databases..." />
            <FilterBar filters={filters} onChange={setFilters} />
            <Button to="/dashboard/cloud-hosting/databases/create" variant="primary">Create Database</Button>
          </div>

          <Table 
            columns={[
              { key: 'name', label: 'Database Name', sortable: true },
              { key: 'type', label: 'Type', sortable: true },
              { key: 'status', label: 'Status', sortable: true },
              { key: 'size', label: 'Size', sortable: true },
              { key: 'connection', label: 'Connection', sortable: false },
              { key: 'actions', label: 'Actions', sortable: false }
            ]}
            data={databases}
            rowKey="id"
            renderCell={(column, row) => {
              switch (column.key) {
                case 'actions':
                  return (
                    <div className="action-buttons">
                      <Button size="small" variant="secondary" to={`/dashboard/cloud-hosting/databases/${row.id}`}>View</Button>
                      <Button size="small" variant="secondary" onClick={() => handleBackup(row.id)}>Backup</Button>
                      <Button size="small" variant="danger" onClick={() => handleDelete(row.id)}>Delete</Button>
                    </div>
                  );
                case 'status':
                  return <span className={`status-${row.status}`}>{row.status}</span>;
                case 'connection':
                  return <span className="connection-string">{row.connection}</span>;
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

interface Database {
  id: string;
  name: string;
  type: 'postgresql' | 'mysql' | 'mongodb' | 'redis';
  status: 'running' | 'stopped' | 'creating' | 'failed';
  size: string;
  connection: string;
}

interface FilterOptions {
  type?: 'postgresql' | 'mysql' | 'mongodb' | 'redis';
  status?: 'running' | 'stopped' | 'creating' | 'failed';
}

const handleBackup = async (dbId: string) => {
  // Implementation for database backup via Dokploy API
};

const handleDelete = async (dbId: string) => {
  // Implementation for database deletion via Dokploy API
};
