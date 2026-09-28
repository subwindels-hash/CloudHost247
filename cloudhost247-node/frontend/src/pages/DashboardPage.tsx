import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface MeResponse {
  user: { id: string; email: string; fullName: string; role: string };
}

export default function DashboardPage() {
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<MeResponse>('/api/auth/me')
      .then((res) => setMe(res.user))
      .catch((err) => setError(err instanceof Error ? err.message : 'Not logged in'));
  }, []);

  return (
    <div className="ch247-card">
      <h1>Dashboard</h1>
      {me ? (
        <p>
          Signed in as <strong>{me.fullName}</strong> ({me.email}) — role: {me.role}
        </p>
      ) : (
        <p>{error ?? 'Loading…'} Please log in to see account details.</p>
      )}
    </div>
  );
}
