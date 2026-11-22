async function loadWrongAnswerData(){
  if(!currentUser)throw new Error('Please sign in first.');
  const userId=currentUser.id;
  const cutoff=encodeURIComponent(new Date().toISOString());
  const read=table=>WrongAnswerRetake.readPages(async offset=>{
    const order=table==='question_history'?'answered_at.asc,id.asc':'answered_at.asc,question_id.asc';
    const url=`${SB_URL}/rest/v1/${table}?select=question_id,topic,is_correct,answered_at&user_id=eq.${encodeURIComponent(userId)}&is_correct=not.is.null&answered_at=lte.${cutoff}&order=${order}&limit=500&offset=${offset}`;
    const response=await fetch(url,{headers:sbH()});
    if(!response.ok)throw new Error('Answer history could not be loaded.');
    return response.json();
  });
  const [study,quiz]=await Promise.all([read('study_question_history'),read('question_history')]);
  if(currentUser?.id!==userId)throw new Error('The signed-in account changed.');
  const bank=[...allQuestions,...(window.PREVIOUS_YEAR_036_2022||[]),...(window.PREVIOUS_YEAR_326_2022||[])];
  return WrongAnswerRetake.analyse([...study,...quiz],bank,QuestionSelection.key);
}

async function renderWeakAreas(targetId,userId){
  const target=document.getElementById(targetId);
  if(!target)return;
  target.innerHTML='<div class="text-muted" role="status">Loading your weak areas…</div>';
  try{
    const data=await loadWrongAnswerData();
    if(currentUser?.id!==userId)return;
    if(!data.topics.length){
      target.innerHTML='<div class="weakness-empty">No wrong answers recorded yet. Complete a quiz to discover your weak areas.</div>';
      return;
    }
    const row=t=>`<div class="weak-area-row"><div><strong>${escapeDashboardHtml(t.topic)}</strong><p class="text-muted">${t.wrong} wrong / ${t.answered} answered · ${t.errorRate}% error rate${t.answered<20?' · Small sample':''}</p><div class="progress-bar" role="img" aria-label="${t.errorRate}% error rate"><div style="height:100%;width:${t.errorRate}%;background:var(--danger)"></div></div></div><span class="chip ${t.pending?'chip-red':'chip-green'}">${t.pending} to retake</span></div>`;
    target.innerHTML=`<p class="text-muted mb-16">Most mistakes first. Error rates show how often you answered incorrectly; counts include repeated attempts.</p>${data.topics.slice(0,6).map(row).join('')}${data.topics.length>6?`<details><summary style="cursor:pointer;padding:12px 0;color:var(--primary)">Show ${data.topics.length-6} more areas</summary>${data.topics.slice(6).map(row).join('')}</details>`:''}<div class="retake-home-action"><span class="text-muted">${data.pending.length} questions still need a correct answer</span><button class="btn btn-primary btn-sm" onclick="showScreen('wrong-answers-setup')">Retake wrong answers →</button></div>`;
  }catch(error){
    if(currentUser?.id===userId)target.innerHTML='<div class="alert alert-danger" role="status">Your weak areas could not be loaded. <button class="btn btn-ghost btn-sm" onclick="loadDashboardWeakness(\'dash-weakness\',currentUser.id)">Try again</button></div>';
  }
}

let wrongAnswersSetupRequest=0;
async function loadWrongAnswersSetup(){
  const request=++wrongAnswersSetupRequest;
  const status=document.getElementById('wa-status');
  const topicSelect=document.getElementById('wa-topic');
  const button=document.getElementById('wa-start');
  const previousTopic=topicSelect.value;
  button.disabled=true;
  topicSelect.disabled=true;
  topicSelect.innerHTML='<option value="all">All topics</option>';
  status.textContent='Loading your wrong answers…';
  try{
    const data=await loadWrongAnswerData();
    if(request!==wrongAnswersSetupRequest)return;
    const counts=new Map();
    data.pending.forEach(q=>counts.set(q.s,(counts.get(q.s)||0)+1));
    for(const [topic,count] of [...counts].sort((a,b)=>a[0].localeCompare(b[0]))){
      const option=document.createElement('option');
      option.value=topic;option.textContent=`${topic} (${count})`;topicSelect.appendChild(option);
    }
    if(counts.has(previousTopic))topicSelect.value=previousTopic;
    topicSelect.disabled=!data.pending.length;
    button.disabled=!data.pending.length;
    status.textContent=data.pending.length?`${data.pending.length} questions ready to retake. Choose a topic or practise across all topics.`:'No wrong answers left to retake. Well done! New mistakes will appear here after you submit a quiz.';
  }catch(error){
    if(request===wrongAnswersSetupRequest)status.innerHTML='Could not load your answer history. <button class="btn btn-ghost btn-sm" onclick="loadWrongAnswersSetup()">Try again</button>';
  }
}

async function startWrongAnswersQuiz(){
  if(startingQuiz||!currentUser)return;
  startingQuiz=true;
  const button=document.getElementById('wa-start');
  button.disabled=true;
  const userId=currentUser.id;
  try{
    const data=await loadWrongAnswerData();
    const topic=document.getElementById('wa-topic').value;
    const pool=data.pending.filter(q=>topic==='all'||q.s===topic);
    const value=document.getElementById('wa-count').value;
    const count=value==='all'?pool.length:Number(value);
    const questions=shuffleArr(pool).slice(0,count);
    if(!questions.length){await loadWrongAnswersSetup();return;}
    if(quizState?.timerInterval)clearInterval(quizState.timerInterval);
    quizState={questions,answers:new Array(questions.length).fill(-1),currentIdx:0,startTime:Date.now(),topic:`Wrong Answers Retake · ${topic==='all'?'All Topics':topic}`,mode:'practice',negative:false,timerInterval:null,isRevision:false,isWrongRetake:true,histMap:null};
    document.getElementById('quiz-topic-label').textContent=quizState.topic;
    buildPalette();renderQuizQuestion();showScreen('quiz');
  }catch(error){
    if(currentUser?.id===userId)alert('Your wrong answers could not be loaded. Please try again.');
  }finally{startingQuiz=false;button.disabled=false;}
}
