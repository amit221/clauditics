import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function Timeline({ data }) {
  const sorted = [...data].reverse(); // oldest first
  return (
    <div>
      <h2>Daily Token Usage</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={sorted}>
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="input_tokens" stroke="#6366f1" name="Input" />
          <Line type="monotone" dataKey="output_tokens" stroke="#22d3ee" name="Output" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
