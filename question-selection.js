// Shared by the browser and the regression tests. Base records/IDs stay intact.
(function(root){
  function key(question){
    return question.q.normalize('NFKC').toLowerCase()
      .replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
  }
  function unique(questions){
    const keys=new Set(),ids=new Set();
    return questions.filter(q=>{
      const k=key(q);
      if(keys.has(k)||ids.has(q.id)) return false;
      keys.add(k);ids.add(q.id);return true;
    });
  }
  function seenKeys(bank,seenIds){
    return new Set(bank.filter(q=>seenIds.has(q.id)).map(key));
  }
  function unseen(pool,bank,seenIds){
    const seen=seenKeys(bank,seenIds);
    return unique(pool).filter(q=>!seen.has(key(q)));
  }
  const api={key,unique,seenKeys,unseen};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.QuestionSelection=api;
})(typeof globalThis!=='undefined'?globalThis:this);
