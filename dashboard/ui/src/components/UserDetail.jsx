export default function UserDetail({ user, events }) {
  return (
    <div>
      <h2>{user} — Session History</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Timestamp</th><th>Model</th><th>Input</th><th>Output</th></tr></thead>
        <tbody>
          {events.map(e => (
            <tr key={e.session_id}>
              <td>{e.timestamp}</td>
              <td>{e.model}</td>
              <td>{e.input_tokens.toLocaleString()}</td>
              <td>{e.output_tokens.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
