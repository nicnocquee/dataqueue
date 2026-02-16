/**
 * Generate the complete dashboard HTML page.
 * The page is a self-contained React SPA with embedded CSS and JS.
 * React and ReactDOM are loaded from esm.sh CDN.
 */
export function generateDashboardHTML(basePath: string): string {
  const normalizedBase = basePath.endsWith('/')
    ? basePath.slice(0, -1)
    : basePath;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dataqueue Dashboard</title>
  <style>${CSS}</style>
</head>
<body>
  <div id="root"></div>
  <script>window.__DQ_BASE_PATH__ = ${JSON.stringify(normalizedBase)};</script>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19?dev",
      "react-dom/client": "https://esm.sh/react-dom@19/client?dev"
    }
  }
  </script>
  <script type="module">${CLIENT_JS}</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const CSS = /* css */ `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root {
  --bg: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-hover: #f1f3f5;
  --border: #dee2e6;
  --text: #212529;
  --text-secondary: #6c757d;
  --text-muted: #adb5bd;
  --primary: #228be6;
  --primary-hover: #1c7ed6;
  --primary-light: #e7f5ff;
  --success: #40c057;
  --success-light: #ebfbee;
  --danger: #fa5252;
  --danger-light: #fff5f5;
  --warning: #fab005;
  --warning-light: #fff9db;
  --info: #15aabf;
  --info-light: #e3fafc;
  --radius: 6px;
  --radius-lg: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", Menlo, monospace;
  --transition: 150ms ease;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1b1e;
    --bg-secondary: #25262b;
    --bg-hover: #2c2e33;
    --border: #373a40;
    --text: #c1c2c5;
    --text-secondary: #909296;
    --text-muted: #5c5f66;
    --primary: #4dabf7;
    --primary-hover: #339af0;
    --primary-light: #1b2838;
    --success: #51cf66;
    --success-light: #1b2e1b;
    --danger: #ff6b6b;
    --danger-light: #2e1b1b;
    --warning: #fcc419;
    --warning-light: #2e2a1b;
    --info: #22b8cf;
    --info-light: #1b2b2e;
    --shadow: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
    --shadow-md: 0 4px 6px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.2);
  }
}

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.dq-layout {
  display: flex;
  min-height: 100vh;
}

.dq-sidebar {
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  padding: 20px 0;
  flex-shrink: 0;
}

.dq-sidebar-title {
  font-size: 14px;
  font-weight: 700;
  padding: 0 16px 16px;
  color: var(--text);
  letter-spacing: -0.02em;
}

.dq-sidebar-title span {
  color: var(--primary);
}

.dq-nav-item {
  display: block;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  transition: all var(--transition);
}

.dq-nav-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.dq-nav-item.active {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 500;
}

.dq-main {
  flex: 1;
  padding: 24px 32px;
  min-width: 0;
  overflow-x: auto;
}

.dq-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.dq-header h1 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.dq-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dq-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: all var(--transition);
  white-space: nowrap;
}

.dq-btn:hover { background: var(--bg-hover); }
.dq-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.dq-btn-primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}
.dq-btn-primary:hover { background: var(--primary-hover); }

.dq-btn-danger {
  color: var(--danger);
  border-color: var(--danger);
}
.dq-btn-danger:hover { background: var(--danger-light); }

.dq-btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.dq-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.dq-tab {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all var(--transition);
  font-family: var(--font);
  white-space: nowrap;
}

.dq-tab:hover { color: var(--text); }

.dq-tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.dq-tab .dq-count {
  margin-left: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.dq-tab.active .dq-count {
  background: var(--primary-light);
  color: var(--primary);
}

.dq-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.dq-card-header {
  padding: 14px 16px;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}

.dq-card-body { padding: 16px; }

.dq-table-wrap { overflow-x: auto; }

table.dq-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.dq-table th {
  text-align: left;
  padding: 10px 12px;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.dq-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.dq-table tr:last-child td { border-bottom: none; }

.dq-table tr:hover td { background: var(--bg-hover); }

.dq-table .dq-id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--primary);
  cursor: pointer;
  font-weight: 500;
}

.dq-table .dq-id:hover { text-decoration: underline; }

.dq-table .dq-type {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-secondary);
  padding: 2px 8px;
  border-radius: 4px;
}

.dq-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 10px;
  text-transform: capitalize;
  white-space: nowrap;
}

.dq-badge-pending { background: var(--warning-light); color: var(--warning); }
.dq-badge-processing { background: var(--primary-light); color: var(--primary); }
.dq-badge-completed { background: var(--success-light); color: var(--success); }
.dq-badge-failed { background: var(--danger-light); color: var(--danger); }
.dq-badge-cancelled { background: var(--bg-hover); color: var(--text-muted); }
.dq-badge-waiting { background: var(--info-light); color: var(--info); }

.dq-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.dq-pagination-btns {
  display: flex;
  gap: 8px;
}

.dq-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

@media (max-width: 900px) {
  .dq-detail-grid { grid-template-columns: 1fr; }
  .dq-sidebar { width: 180px; }
}

@media (max-width: 700px) {
  .dq-layout { flex-direction: column; }
  .dq-sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border); padding: 12px 0; }
  .dq-main { padding: 16px; }
}

.dq-prop-table { width: 100%; font-size: 13px; }

.dq-prop-table td {
  padding: 6px 0;
  vertical-align: top;
}

.dq-prop-table td:first-child {
  color: var(--text-secondary);
  width: 160px;
  font-weight: 500;
  padding-right: 12px;
}

.dq-code-block {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.dq-timeline { position: relative; padding-left: 24px; }

.dq-timeline::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--border);
}

.dq-timeline-item {
  position: relative;
  padding-bottom: 16px;
}

.dq-timeline-item:last-child { padding-bottom: 0; }

.dq-timeline-dot {
  position: absolute;
  left: -20px;
  top: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--primary);
  border: 2px solid var(--bg);
  box-shadow: 0 0 0 2px var(--border);
}

.dq-timeline-dot.completed { background: var(--success); }
.dq-timeline-dot.failed { background: var(--danger); }
.dq-timeline-dot.cancelled { background: var(--text-muted); }

.dq-timeline-time {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.dq-timeline-type {
  font-size: 13px;
  font-weight: 500;
  text-transform: capitalize;
}

.dq-timeline-meta {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.dq-back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  margin-bottom: 16px;
  background: none;
  border: none;
  font-family: var(--font);
  padding: 0;
}
.dq-back-link:hover { color: var(--primary); }

.dq-empty {
  text-align: center;
  padding: 48px 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.dq-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: dq-spin 0.6s linear infinite;
}

@keyframes dq-spin { to { transform: rotate(360deg); } }

.dq-loading-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 0;
}

.dq-tag {
  display: inline-block;
  padding: 1px 6px;
  font-size: 11px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-right: 4px;
  font-family: var(--font-mono);
}

.dq-progress-bar {
  width: 100%;
  height: 6px;
  background: var(--bg-hover);
  border-radius: 3px;
  overflow: hidden;
}

.dq-progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 300ms ease;
}

.dq-error-item {
  background: var(--danger-light);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 8px;
  font-size: 12px;
}
.dq-error-item:last-child { margin-bottom: 0; }

.dq-error-item .dq-error-time {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  margin-bottom: 4px;
}

.dq-error-item .dq-error-msg {
  font-family: var(--font-mono);
  color: var(--danger);
  word-break: break-all;
}

.dq-select {
  padding: 7px 10px;
  font-size: 13px;
  font-family: var(--font);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}

.dq-auto-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.dq-auto-refresh input[type="checkbox"] {
  accent-color: var(--primary);
}

.dq-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 10px 16px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: var(--text);
  box-shadow: var(--shadow-md);
  z-index: 1000;
  animation: dq-fade-in 200ms ease;
}

.dq-toast.success { background: var(--success); }
.dq-toast.error { background: var(--danger); }

@keyframes dq-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
`;

// ---------------------------------------------------------------------------
// Client JS (React SPA)
// ---------------------------------------------------------------------------
const CLIENT_JS = /* js */ `
import React from 'react';
import { createRoot } from 'react-dom/client';

const h = React.createElement;
const F = React.Fragment;
const { useState, useEffect, useCallback, useRef } = React;

const BASE = window.__DQ_BASE_PATH__;

// --- API Client ---
async function api(path, opts = {}) {
  const res = await fetch(BASE + '/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed: ' + res.status);
  }
  return res.json();
}

// --- Utils ---
function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function prettyJSON(val) {
  try { return JSON.stringify(val, null, 2); }
  catch { return String(val); }
}

// --- Toast ---
let toastTimer;
function Toast({ toast, setToast }) {
  useEffect(() => {
    if (toast) {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(null), 3000);
    }
  }, [toast]);
  if (!toast) return null;
  return h('div', { className: 'dq-toast ' + (toast.type || '') }, toast.msg);
}

// --- Status Badge ---
function StatusBadge({ status }) {
  return h('span', { className: 'dq-badge dq-badge-' + status }, status);
}

// --- Pagination ---
function Pagination({ offset, limit, hasMore, onPrev, onNext }) {
  const page = Math.floor(offset / limit) + 1;
  return h('div', { className: 'dq-pagination' },
    h('span', null, 'Page ' + page),
    h('div', { className: 'dq-pagination-btns' },
      h('button', { className: 'dq-btn dq-btn-sm', disabled: offset === 0, onClick: onPrev }, '← Previous'),
      h('button', { className: 'dq-btn dq-btn-sm', disabled: !hasMore, onClick: onNext }, 'Next →'),
    ),
  );
}

// --- Event Timeline ---
function EventTimeline({ events }) {
  if (!events.length) return h('div', { className: 'dq-empty' }, 'No events recorded');
  const sorted = [...events].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return h('div', { className: 'dq-timeline' },
    sorted.map(ev =>
      h('div', { key: ev.id, className: 'dq-timeline-item' },
        h('div', { className: 'dq-timeline-dot ' + ev.eventType }),
        h('div', { className: 'dq-timeline-time' }, formatDate(ev.createdAt)),
        h('div', { className: 'dq-timeline-type' }, ev.eventType),
        ev.metadata ? h('div', { className: 'dq-timeline-meta' }, prettyJSON(ev.metadata)) : null,
      )
    ),
  );
}

// --- Job Detail Page ---
function JobDetailPage({ jobId, onBack, showToast }) {
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [jRes, eRes] = await Promise.all([
        api('/jobs/' + jobId),
        api('/jobs/' + jobId + '/events'),
      ]);
      setJob(jRes.job);
      setEvents(eRes.events);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(action) {
    setActing(true);
    try {
      await api('/jobs/' + jobId + '/' + action, { method: 'POST' });
      showToast(action === 'cancel' ? 'Job cancelled' : 'Job retried', 'success');
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setActing(false);
    }
  }

  if (loading) return h('div', { className: 'dq-loading-overlay' }, h('div', { className: 'dq-spinner' }));
  if (!job) return h('div', { className: 'dq-empty' }, 'Job not found');

  const canCancel = job.status === 'pending' || job.status === 'waiting';
  const canRetry = job.status === 'failed' || job.status === 'cancelled';

  return h(F, null,
    h('button', { className: 'dq-back-link', onClick: onBack }, '← Back to Jobs'),
    h('div', { className: 'dq-header' },
      h('h1', null, 'Job #' + job.id, ' ', h(StatusBadge, { status: job.status })),
      h('div', { className: 'dq-header-actions' },
        canCancel ? h('button', { className: 'dq-btn dq-btn-danger dq-btn-sm', onClick: () => handleAction('cancel'), disabled: acting }, 'Cancel') : null,
        canRetry ? h('button', { className: 'dq-btn dq-btn-primary dq-btn-sm', onClick: () => handleAction('retry'), disabled: acting }, 'Retry') : null,
      ),
    ),

    h('div', { className: 'dq-detail-grid' },
      h('div', { className: 'dq-card' },
        h('div', { className: 'dq-card-header' }, 'Properties'),
        h('div', { className: 'dq-card-body' },
          h('table', { className: 'dq-prop-table' },
            h('tbody', null,
              propRow('Type', h('span', { className: 'dq-type' }, job.jobType)),
              propRow('Status', h(StatusBadge, { status: job.status })),
              propRow('Priority', job.priority),
              propRow('Attempts', job.attempts + ' / ' + job.maxAttempts),
              job.progress != null ? propRow('Progress', h(F, null, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('div', { className: 'dq-progress-bar', style: { width: '100px' } }, h('div', { className: 'dq-progress-fill', style: { width: job.progress + '%' } })), job.progress + '%'))) : null,
              propRow('Created', formatDate(job.createdAt)),
              propRow('Updated', formatDate(job.updatedAt)),
              job.startedAt ? propRow('Started', formatDate(job.startedAt)) : null,
              job.completedAt ? propRow('Completed', formatDate(job.completedAt)) : null,
              job.runAt ? propRow('Run At', formatDate(job.runAt)) : null,
              job.timeoutMs ? propRow('Timeout', job.timeoutMs + 'ms') : null,
              job.tags && job.tags.length ? propRow('Tags', h(F, null, job.tags.map(t => h('span', { key: t, className: 'dq-tag' }, t)))) : null,
              job.idempotencyKey ? propRow('Idempotency Key', h('code', null, job.idempotencyKey)) : null,
              job.failureReason ? propRow('Failure Reason', job.failureReason) : null,
              job.pendingReason ? propRow('Pending Reason', job.pendingReason) : null,
              job.waitTokenId ? propRow('Wait Token', h('code', null, job.waitTokenId)) : null,
            ),
          ),
        ),
      ),

      h('div', { className: 'dq-card' },
        h('div', { className: 'dq-card-header' }, 'Payload'),
        h('div', { className: 'dq-card-body' },
          h('pre', { className: 'dq-code-block' }, prettyJSON(job.payload)),
        ),
      ),
    ),

    job.errorHistory && job.errorHistory.length
      ? h('div', { className: 'dq-card', style: { marginBottom: '16px' } },
          h('div', { className: 'dq-card-header' }, 'Error History'),
          h('div', { className: 'dq-card-body' },
            job.errorHistory.map((err, i) =>
              h('div', { key: i, className: 'dq-error-item' },
                h('div', { className: 'dq-error-time' }, err.timestamp),
                h('div', { className: 'dq-error-msg' }, err.message),
              )
            ),
          ),
        )
      : null,

    job.stepData && Object.keys(job.stepData).length
      ? h('div', { className: 'dq-card', style: { marginBottom: '16px' } },
          h('div', { className: 'dq-card-header' }, 'Step Data'),
          h('div', { className: 'dq-card-body' },
            h('pre', { className: 'dq-code-block' }, prettyJSON(job.stepData)),
          ),
        )
      : null,

    h('div', { className: 'dq-card' },
      h('div', { className: 'dq-card-header' }, 'Events (' + events.length + ')'),
      h('div', { className: 'dq-card-body' }, h(EventTimeline, { events })),
    ),
  );
}

function propRow(label, value) {
  return h('tr', null,
    h('td', null, label),
    h('td', null, value),
  );
}

// --- Jobs List Page ---
function JobsPage({ onSelectJob, showToast }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const limit = 25;
  const intervalRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (status) params.set('status', status);
      const data = await api('/jobs?' + params.toString());
      setJobs(data.jobs);
      setHasMore(data.hasMore);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [status, offset]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 3000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, load]);

  async function handleProcess() {
    setProcessing(true);
    try {
      const res = await api('/process', { method: 'POST' });
      showToast('Processed ' + res.processed + ' job(s)', 'success');
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setProcessing(false);
    }
  }

  async function handleAction(jobId, action) {
    try {
      await api('/jobs/' + jobId + '/' + action, { method: 'POST' });
      showToast(action === 'cancel' ? 'Job cancelled' : 'Job retried', 'success');
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  const statuses = ['', 'pending', 'processing', 'completed', 'failed', 'cancelled', 'waiting'];

  return h(F, null,
    h('div', { className: 'dq-header' },
      h('h1', null, 'Jobs'),
      h('div', { className: 'dq-header-actions' },
        h('label', { className: 'dq-auto-refresh' },
          h('input', { type: 'checkbox', checked: autoRefresh, onChange: e => setAutoRefresh(e.target.checked) }),
          'Auto-refresh',
        ),
        h('button', { className: 'dq-btn', onClick: () => { setLoading(true); load(); } }, 'Refresh'),
        h('button', {
          className: 'dq-btn dq-btn-primary',
          onClick: handleProcess,
          disabled: processing,
        }, processing ? h('span', { className: 'dq-spinner' }) : null, processing ? 'Processing...' : 'Process Jobs'),
      ),
    ),

    h('div', { className: 'dq-tabs' },
      statuses.map(s =>
        h('button', {
          key: s || 'all',
          className: 'dq-tab' + (status === s ? ' active' : ''),
          onClick: () => { setStatus(s); setOffset(0); },
        }, s || 'All')
      ),
    ),

    h('div', { className: 'dq-card' },
      h('div', { className: 'dq-table-wrap' },
        loading
          ? h('div', { className: 'dq-loading-overlay' }, h('div', { className: 'dq-spinner' }))
          : jobs.length === 0
            ? h('div', { className: 'dq-empty' }, 'No jobs found')
            : h('table', { className: 'dq-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, 'ID'),
                    h('th', null, 'Type'),
                    h('th', null, 'Status'),
                    h('th', null, 'Priority'),
                    h('th', null, 'Attempts'),
                    h('th', null, 'Created'),
                    h('th', null, 'Actions'),
                  ),
                ),
                h('tbody', null,
                  jobs.map(j =>
                    h('tr', { key: j.id },
                      h('td', null, h('span', { className: 'dq-id', onClick: () => onSelectJob(j.id) }, '#' + j.id)),
                      h('td', null, h('span', { className: 'dq-type' }, j.jobType)),
                      h('td', null, h(StatusBadge, { status: j.status })),
                      h('td', null, j.priority),
                      h('td', null, j.attempts + '/' + j.maxAttempts),
                      h('td', { title: formatDate(j.createdAt) }, timeAgo(j.createdAt)),
                      h('td', null,
                        h('div', { style: { display: 'flex', gap: '4px' } },
                          (j.status === 'pending' || j.status === 'waiting')
                            ? h('button', { className: 'dq-btn dq-btn-danger dq-btn-sm', onClick: () => handleAction(j.id, 'cancel') }, 'Cancel')
                            : null,
                          (j.status === 'failed' || j.status === 'cancelled')
                            ? h('button', { className: 'dq-btn dq-btn-sm', onClick: () => handleAction(j.id, 'retry') }, 'Retry')
                            : null,
                        ),
                      ),
                    )
                  ),
                ),
              ),
      ),
      !loading && jobs.length > 0
        ? h(Pagination, {
            offset,
            limit,
            hasMore,
            onPrev: () => setOffset(Math.max(0, offset - limit)),
            onNext: () => setOffset(offset + limit),
          })
        : null,
    ),
  );
}

// --- App ---
function App() {
  const [route, setRoute] = useState(parseHash());
  const [toast, setToast] = useState(null);

  useEffect(() => {
    function onHash() { setRoute(parseHash()); }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function navigate(hash) { window.location.hash = hash; }
  function showToast(msg, type) { setToast({ msg, type }); }

  return h('div', { className: 'dq-layout' },
    h('nav', { className: 'dq-sidebar' },
      h('div', { className: 'dq-sidebar-title' }, h('span', null, 'dataqueue'), ' Dashboard'),
      h('button', {
        className: 'dq-nav-item' + (route.page === 'jobs' && !route.jobId ? ' active' : ''),
        onClick: () => navigate('#/'),
      }, 'Jobs'),
    ),
    h('main', { className: 'dq-main' },
      route.page === 'detail' && route.jobId
        ? h(JobDetailPage, { jobId: route.jobId, onBack: () => navigate('#/'), showToast })
        : h(JobsPage, { onSelectJob: id => navigate('#/jobs/' + id), showToast }),
    ),
    h(Toast, { toast, setToast }),
  );
}

function parseHash() {
  const hash = window.location.hash.replace(/^#\\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'jobs' && parts[1]) {
    return { page: 'detail', jobId: parseInt(parts[1], 10) };
  }
  return { page: 'jobs', jobId: null };
}

// --- Mount ---
createRoot(document.getElementById('root')).render(h(App, null));
`;
