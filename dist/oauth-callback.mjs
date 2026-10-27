const fragment=location.hash,query=location.search;
history.replaceState(null,'',location.pathname);
if(window.opener && location.origin==='http://127.0.0.1:4173') {
  const opener=window.opener;
  window.addEventListener('message',event=>{
    if(event.origin===location.origin && event.source===opener && event.data?.type==='streamer-mayhem-local-oauth-ack')window.close();
  },{once:false});
  window.opener.postMessage({type:'streamer-mayhem-local-oauth',fragment,query},location.origin);
  // If the opener disappeared or rejects the message, do not leave an orphan.
  setTimeout(()=>window.close(),5000);
}
