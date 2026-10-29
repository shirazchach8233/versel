// Shared by the browser and the regression tests. Base records/IDs stay intact.
(function(root){
  function key(question){
    return question.q.normalize('NFKC').toLowerCase()
      .replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
      .replace(/[^\p{L}\p{N}_]+/gu,' ').replace(/\s+/g,' ').trim();
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
  function viewed(pool,bank,seenIds){
    const seen=seenKeys(bank,seenIds);
    return unique(pool).filter(q=>seen.has(key(q)));
  }
  function latestResultsByKey(bank,lastSeen,lastCorrect){
    const results=new Map();
    bank.forEach(q=>{
      if(!lastSeen.has(q.id))return;
      const k=key(q),at=lastSeen.get(q.id);
      const previous=results.get(k);
      if(!previous||at>=previous.at)results.set(k,{at,correct:lastCorrect.get(q.id)});
    });
    return results;
  }
  function quizEligible(pool,bank,lastSeen,lastCorrect,locallyViewedIds){
    const locallyViewed=seenKeys(bank,locallyViewedIds);
    return unique(pool).filter(q=>{
      // Quiz Mode is a learning path, not a retry queue. Once a question has
      // appeared in Quiz Mode it stays out of future quizzes; Study Review is
      // the explicit place to revisit studied questions.
      return !locallyViewed.has(key(q));
    });
  }
  const api={key,unique,seenKeys,unseen,viewed,latestResultsByKey,quizEligible};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.QuestionSelection=api;
})(typeof globalThis!=='undefined'?globalThis:this);
