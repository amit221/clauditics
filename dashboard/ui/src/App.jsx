import { useState, useEffect } from 'react';
import { fetchStats } from './api';
import Overview from './components/Overview';
import Models from './components/Models';
import Timeline from './components/Timeline';
import UserDetail from './components/UserDetail';

export default function App() {
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('overview');
  const [selectedUser, setSelectedUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('teamToken') || '');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetchStats(token)
      .then(setStats)
      .catch(e => setError(e.message));
  }, [token]);

  if (!token) {
    return (
      <div style={{ padding: 32 }}>
        <h1>Clauditics</h1>
        <input placeholder="Team token" onBlur={e => { localStorage.setItem('teamToken', e.target.value); setToken(e.target.value); }} />
      </div>
    );
  }

  if (error) return <div style={{ padding: 32, color: 'red' }}>Error: {error}</div>;
  if (!stats) return <div style={{ padding: 32 }}>Loading...</div>;

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 32 }}>
      <h1>Clauditics</h1>
      <nav style={{ marginBottom: 24 }}>
        {['overview', 'models', 'timeline'].map(t => (
          <button key={t} onClick={() => { setTab(t); setSelectedUser(null); }} style={{ marginRight: 8, fontWeight: tab === t ? 'bold' : 'normal' }}>{t}</button>
        ))}
      </nav>
      {tab === 'overview' && !selectedUser && <Overview data={stats.byUser} onSelectUser={setSelectedUser} />}
      {tab === 'overview' && selectedUser && <UserDetail user={selectedUser} events={stats.byUser.find(u => u.user === selectedUser)?.events || []} onBack={() => setSelectedUser(null)} />}
      {tab === 'models' && <Models data={stats.byModel} />}
      {tab === 'timeline' && <Timeline data={stats.byDay} />}
    </div>
  );
}
