// Google Apps Script behind the "Request a feature" box. It does not run from this
// repo: paste it into a project at https://script.google.com, signed in as the
// receiving account, then Deploy > New deployment > Web app
// (Execute as: Me, Who has access: Anyone) and copy the /exec URL into
// FEEDBACK_URL in src/feedback.js. After editing the script, publish it with
// Deploy > Manage deployments > edit > Version: New version (the URL stays).

const TO = 'orbitgenomeviewer@gmail.com' // fixed here, so the URL can't be used to mail anyone else
const MAX_MESSAGE = 5000

function doPost(e) {
  const p = (e && e.parameter) || {}
  if (p.website) return reply(true) // hidden field only bots fill in: pretend it worked
  const message = String(p.message || '').trim()
  if (!message || message.length > MAX_MESSAGE) return reply(false)
  const from = String(p.email || '').trim()
  const valid = from.length <= 254 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(from)
  MailApp.sendEmail(TO, 'OrbiT feature request', message + '\n\nReply to: ' + (valid ? from : 'not given'), valid ? { replyTo: from } : {})
  return reply(true)
}

function reply(ok) {
  return ContentService.createTextOutput(JSON.stringify({ ok: ok })).setMimeType(ContentService.MimeType.JSON)
}
