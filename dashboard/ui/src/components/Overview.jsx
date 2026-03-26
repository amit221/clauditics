import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function Overview({ data }) {
  return (
    <div>
      <h2>Token Usage by User</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <XAxis dataKey="user" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="input_tokens" fill="#6366f1" name="Input" />
          <Bar dataKey="output_tokens" fill="#22d3ee" name="Output" />
        </BarChart>
      </ResponsiveContainer>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead><tr><th>User</th><th>Input Tokens</th><th>Output Tokens</th><th>Sessions</th></tr></thead>
        <tbody>
          {data.map(row => (
            <tr key={row.user}>
              <td>{row.user}</td>
              <td>{row.input_tokens.toLocaleString()}</td>
              <td>{row.output_tokens.toLocaleString()}</td>
              <td>{row.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
