export async function fetchStats(teamToken) {
  const res = await fetch('/api/stats', {
    headers: { 'X-Team-Token': teamToken },
  });
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}
