const H2 = 'style="font-size:1.2rem;margin-top:28px;"';

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy Policy</title>
</head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;line-height:1.6;color:#1e293b;background:#ffffff;">
<h1 style="font-size:1.75rem;margin-bottom:4px;">Privacy Policy</h1>
<p style="color:#64748b;margin-top:0;">This is an educational service for students. This page explains, in plain language, what it records and why.</p>

<h2 ${H2}>What we collect</h2>
<ul>
<li>The questions you submit to the chat and the Concept Explainer.</li>
<li>Transaction traces: the AI model used, an estimate of the token count, the answer generated, and a timestamp.</li>
</ul>

<h2 ${H2}>What we do not collect</h2>
<ul>
<li>No personal information: no names and no email addresses.</li>
<li>No login or account is required to use the service.</li>
</ul>
<p>Please do not type personal details (such as your name, address or phone number) into your questions.</p>

<h2 ${H2}>Why we collect it</h2>
<p>Questions and traces are used to understand how the service is used and to improve the quality of answers.</p>

<h2 ${H2}>How long we keep it</h2>
<p>Retention is configurable by your school. By default, data is kept for 90 days and then automatically purged.</p>

<h2 ${H2}>Where it is stored</h2>
<p>Data is stored on Cloudflare infrastructure (D1 database and R2 object storage).</p>

<h2 ${H2}>Sharing with third parties</h2>
<p>We do not share data with anyone, with one exception: the AI language model provider (OpenRouter) receives only the question text and the retrieved study material needed to generate an answer. It does not receive any personal information, because none is collected.</p>

<h2 ${H2}>Right to erasure</h2>
<p>School administrators can request full deletion of all data held for their school at any time.</p>

<h2 ${H2}>Contact</h2>
<p>For questions about this policy or to request deletion of data, please contact your school administrator, who operates this service for your school.</p>
</body>
</html>`;

export function privacyPage(): Response {
  return new Response(HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
