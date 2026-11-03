import type { DigestRow, NightDigest } from '../digest/types.js';

const DASH = '—';

// A row that needs a look: three or more retries, or the job's latest line is a fail.
const needsLook = (row: DigestRow) => row.retries >= 3 || row.lastStatus === 'fail';

const text = (v: string | null) => v ?? DASH;

function DigestRowView({ row }: { row: DigestRow }) {
  return (
    <tr class={needsLook(row) ? 'warn' : undefined}>
      <td>{row.job}</td>
      <td>{text(row.owner)}</td>
      <td>{row.runs}</td>
      <td>{row.retries}</td>
      <td>{row.lastStatus}</td>
      <td>{text(row.lastError)}</td>
      <td>{row.firstAt}</td>
      <td>{row.lastAt}</td>
    </tr>
  );
}

// Rows come from readNight already sorted by job: the page doesn't re-sort (page and JSON share
// one order). A night that wasn't found renders the not-found body; the route sets the 404.
export function DigestPage({ night, digest }: { night: string; digest: NightDigest }) {
  if (!digest.found) return <p class="warn">no run log for {night}</p>;
  return (
    <>
      <h1>digest {night}</h1>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <DigestRowView row={row} />
            ))}
          </tbody>
        </table>
      )}
      <p class="mute">bad lines: {digest.badLines}</p>
    </>
  );
}
