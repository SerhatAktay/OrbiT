// src/feedback.js — the "Request a feature" box. A static page can't send mail, so
// the text goes to a Google Apps Script web app (scripts/feature-request.gs).
// While FEEDBACK_URL is empty the box only offers the email address.
const FEEDBACK_URL = 'https://script.google.com/macros/s/AKfycbw2QZAaHZ5yKlxaUfFqCF-tiYmVfKK1mIh0P-TdfNQfsLCLMLzeYbHtuWV36phvGLCdag/exec'

export function attachFeedback(button, dialog) {
  const form = dialog.querySelector('#feature-form')
  const send = form.querySelector('button')
  const status = dialog.querySelector('#feature-status')
  form.hidden = !FEEDBACK_URL
  button.addEventListener('click', () => { status.textContent = ''; dialog.showModal() })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!form.elements.message.value.trim()) { status.textContent = 'Write a message first.'; return }
    send.disabled = true
    status.textContent = 'Sending…'
    try {
      // URLSearchParams keeps this a "simple" request: Apps Script can't answer a CORS preflight.
      const res = await fetch(FEEDBACK_URL, { method: 'POST', body: new URLSearchParams(new FormData(form)), signal: AbortSignal.timeout(20000) })
      if (!(await res.json()).ok) throw new Error('rejected')
      form.reset()
      status.textContent = 'Sent. Thank you!'
    } catch {
      status.textContent = 'Could not send. Please email the address below instead.' // the text stays in the box
    } finally {
      send.disabled = false
    }
  })
}
