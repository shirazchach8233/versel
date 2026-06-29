// Vercel serverless function: emails a daily activity report (quiz attempts,
// study time, login activity) for every student to a fixed recipient.
// Triggered automatically by the Vercel Cron entry in vercel.json, or can be
// hit manually for testing (see auth check below).
//
// Required environment variables (set in Vercel Project Settings -> Environment Variables):
//   SUPABASE_URL          e.g. https://mjimagtzpfhhzrcjpmff.supabase.co
//   SUPABASE_KEY          Supabase API key (same one the app already uses)
//   GMAIL_USER            the Gmail address used to send AND receive, e.g. shirazchach@gmail.com
//   GMAIL_APP_PASSWORD    16-character Google App Password (NOT the real account password)
//   REPORT_TO             recipient address, e.g. shirazchach@gmail.com
//   CRON_SECRET           random string; Vercel auto-sends it as "Authorization: Bearer <value>"
//                         on scheduled invocations. For manual testing, hit the URL with
//                         ?secret=<value> instead.

const nodemailer = require('nodemailer');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

function sbHeaders() {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
}

async function sbSelect(table, params) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase ${table} query failed: ${r.status} ${await r.text()}`);
  return r.json();
}

function fmtIST(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

function mins(secs) {
  if (!secs && secs !== 0) return '—';
  return `${Math.round(secs / 60)} min`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function table(headers, rows, emptyMsg) {
  if (!rows.length) {
    return `<p style="color:#64748b;font-size:13px;margin:4px 0 16px">${esc(emptyMsg)}</p>`;
  }
  const th = headers.map(h => `<th style="text-align:left;padding:6px 10px;background:#1a3a6b;color:#fff;font-size:12px">${esc(h)}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map(c => `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;width:100%;margin:4px 0 20px"><tr>${th}</tr>${trs}</table>`;
}

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const querySecret = req.query && req.query.secret;
  const authorized = cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret);
  if (!authorized) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const sinceISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [students, attempts, studySessions, logins] = await Promise.all([
      sbSelect('users', `select=id,username,full_name,email&role=eq.student&order=username`),
      sbSelect('quiz_attempts', `select=*&started_at=gte.${sinceISO}&order=started_at`),
      sbSelect('study_sessions', `select=*&started_at=gte.${sinceISO}&order=started_at`),
      sbSelect('login_sessions', `select=*&login_at=gte.${sinceISO}&order=login_at`),
    ]);

    const byUser = (rows) => {
      const m = new Map();
      for (const r of rows) {
        const key = r.username || 'unknown';
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(r);
      }
      return m;
    };
    const attemptsByUser = byUser(attempts);
    const studyByUser = byUser(studySessions);
    const loginsByUser = byUser(logins);

    // ---- Admin summary table ----
    const summaryRows = students.map((u) => {
      const a = attemptsByUser.get(u.username) || [];
      const s = studyByUser.get(u.username) || [];
      const l = loginsByUser.get(u.username) || [];
      const avgScore = a.length ? (a.reduce((sum, x) => sum + Number(x.percentage || 0), 0) / a.length).toFixed(1) + '%' : '—';
      const studyMins = s.reduce((sum, x) => sum + (x.duration_secs || 0), 0);
      const loginMins = l.reduce((sum, x) => sum + (x.duration_secs || 0), 0);
      return [u.full_name || u.username, a.length, avgScore, mins(studyMins), l.length, mins(loginMins)];
    });

    let html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;max-width:680px">
        <h2 style="color:#1a3a6b;margin-bottom:2px">CDPO Quiz — Daily Activity Report</h2>
        <p style="color:#64748b;font-size:13px;margin-top:0">Covering the 24 hours up to ${esc(fmtIST(new Date().toISOString()))} IST</p>
        <h3 style="color:#1a3a6b;border-bottom:2px solid #e2e8f0;padding-bottom:4px">Admin Summary</h3>
        ${table(['Student', 'Quizzes', 'Avg Score', 'Study Time', 'Logins', 'Login Time'], summaryRows, 'No students found.')}
    `;

    // ---- Per-student detail ----
    for (const u of students) {
      const a = attemptsByUser.get(u.username) || [];
      const s = studyByUser.get(u.username) || [];
      const l = loginsByUser.get(u.username) || [];

      html += `<h3 style="color:#1a3a6b;border-bottom:2px solid #e2e8f0;padding-bottom:4px">${esc(u.full_name || u.username)} (@${esc(u.username)})</h3>`;

      html += `<p style="font-size:13px;font-weight:bold;margin:10px 0 2px">Quiz Attempts</p>`;
      html += table(
        ['Topic', 'Mode', 'Score', 'Correct/Wrong/Skipped', 'Duration'],
        a.map(x => [x.topic, x.mode, `${x.percentage != null ? x.percentage + '%' : '—'}`, `${x.correct ?? 0}/${x.wrong ?? 0}/${x.skipped ?? 0}`, mins(x.duration_secs)]),
        'No quizzes taken in the last 24 hours.'
      );

      html += `<p style="font-size:13px;font-weight:bold;margin:10px 0 2px">Study Sessions</p>`;
      html += table(
        ['Topic', 'Questions Viewed', 'Duration'],
        s.map(x => [x.topic, x.questions_viewed ?? 0, mins(x.duration_secs)]),
        'No study sessions in the last 24 hours.'
      );

      html += `<p style="font-size:13px;font-weight:bold;margin:10px 0 2px">Login Activity</p>`;
      html += table(
        ['Login Time (IST)', 'Duration', 'Device', 'Browser', 'OS'],
        l.map(x => [fmtIST(x.login_at), mins(x.duration_secs), x.device_type, x.browser, x.os]),
        'No logins in the last 24 hours.'
      );
    }

    html += `</div>`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.REPORT_TO,
      subject: `CDPO Quiz Daily Report — ${fmtIST(new Date().toISOString())}`,
      html,
    });

    return res.status(200).json({ success: true, students: students.length, attempts: attempts.length, studySessions: studySessions.length, logins: logins.length });
  } catch (err) {
    console.error('daily-report error:', err);
    // Best-effort failure notification so a broken report doesn't fail silently.
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      });
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: process.env.REPORT_TO,
        subject: 'CDPO Quiz Daily Report — FAILED',
        text: `The daily report job failed: ${err.message}`,
      });
    } catch (_) { /* ignore secondary failure */ }
    return res.status(500).json({ success: false, error: err.message });
  }
};
