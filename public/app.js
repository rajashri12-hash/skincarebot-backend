document.addEventListener('DOMContentLoaded',()=>{
  const startBtn = document.getElementById('startChat');
  const viewIntents = document.getElementById('viewIntents');
  const chatBox = document.getElementById('chatBox');
  const cbBody = document.getElementById('cbBody');
  const cbInput = document.getElementById('cbInput');
  const cbSend = document.getElementById('cbSend');
  const SESSION_KEY = 'skincarebot_session_id';

  let sessionId = localStorage.getItem(SESSION_KEY) || '';

  // API endpoint for Dialogflow proxy. Adjust if your server uses a different route.
  const API_URL = '/api/dialogflow';

  startBtn?.addEventListener('click',()=>{
    chatBox.scrollIntoView({behavior:'smooth',block:'center'});
    cbInput?.focus();
  });

  viewIntents?.addEventListener('click',()=>{
    document.getElementById('intents')?.scrollIntoView({behavior:'smooth'});
  });

  cbSend?.addEventListener('click',sendMessage);
  cbInput?.addEventListener('keydown',(e)=>{ if(e.key==='Enter') sendMessage(); });

  async function sendMessage(){
    const val = cbInput.value.trim();
    if(!val) return;

    const u = document.createElement('div'); u.className='msg user';
    u.innerHTML = `<div class="bubble">${escapeHtml(val)}</div>`;
    cbBody.appendChild(u);
    cbInput.value='';
    cbBody.scrollTop = cbBody.scrollHeight;

    // Add typing indicator
    const typing = document.createElement('div'); typing.className = 'msg bot';
    typing.innerHTML = `<div class="bubble">Typing...</div>`;
    cbBody.appendChild(typing);
    cbBody.scrollTop = cbBody.scrollHeight;

    try{
      const res = await fetch(API_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ text: val, sessionId })
      });

      const data = await res.json();

      if (data?.sessionId && data.sessionId !== sessionId) {
        sessionId = data.sessionId;
        localStorage.setItem(SESSION_KEY, sessionId);
      }

      // remove typing indicator
      typing.remove();

      const replyText = data?.reply || data?.fulfillmentText || data?.response || 'No response';
      const b = document.createElement('div'); b.className='msg bot';
      b.innerHTML = `<div class="bubble">${escapeHtml(replyText)}</div>`;
      cbBody.appendChild(b);
      cbBody.scrollTop = cbBody.scrollHeight;

    }catch(err){
      typing.remove();
      const errEl = document.createElement('div'); errEl.className='msg bot';
      errEl.innerHTML = `<div class="bubble">⚠️ Server error. Try again.</div>`;
      cbBody.appendChild(errEl);
      cbBody.scrollTop = cbBody.scrollHeight;
      console.error('Dialogflow proxy error:', err);
    }
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[s]);
  }
});
