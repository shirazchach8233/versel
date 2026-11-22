(function(root){
  'use strict';
  function analyse(records,bank,key){
    const byId=new Map(bank.map(q=>[q.id,q]));
    const latest=new Map(),topics=new Map();
    for(const row of records){
      if(typeof row.is_correct!=='boolean')continue;
      const q=byId.get(row.question_id);
      const topic=q?.s||row.topic||'Other';
      if(!topics.has(topic))topics.set(topic,{topic,answered:0,wrong:0,pending:0});
      const summary=topics.get(topic);
      summary.answered++;
      if(!row.is_correct)summary.wrong++;
      if(!q)continue;
      const questionKey=key(q),at=Date.parse(row.answered_at);
      if(!Number.isFinite(at))continue;
      const previous=latest.get(questionKey);
      // A correct answer wins ties, so older duplicate rows cannot reopen it.
      if(!previous||at>previous.at||(at===previous.at&&row.is_correct)){
        latest.set(questionKey,{q,at,correct:row.is_correct});
      }
    }
    const pending=[...latest.values()].filter(r=>!r.correct).map(r=>r.q);
    for(const q of pending)topics.get(q.s).pending++;
    return {pending,topics:[...topics.values()].filter(t=>t.wrong>0).map(t=>({...t,errorRate:Math.round(t.wrong/t.answered*1000)/10})).sort((a,b)=>b.wrong-a.wrong||b.errorRate-a.errorRate||a.topic.localeCompare(b.topic))};
  }
  async function readPages(fetchPage){
    const records=[];
    for(let offset=0;;){
      const rows=await fetchPage(offset);
      if(!Array.isArray(rows))throw new Error('Invalid answer history.');
      if(!rows.length)return records;
      records.push(...rows);
      offset+=rows.length;
    }
  }
  const api={analyse,readPages};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.WrongAnswerRetake=api;
})(typeof globalThis!=='undefined'?globalThis:this);
