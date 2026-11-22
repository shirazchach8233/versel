const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const selection=require('../question-selection');
const retake=require('../wrong-answer-retake');
const question=(id,text,topic='Psychology')=>({id,q:text,s:topic,o:['Correct','Wrong'],a:0});
const record=(id,correct,day,topic='Psychology')=>({question_id:id,is_correct:correct,answered_at:`2026-11-${day}T12:00:00Z`,topic});

test('retakes latest mistakes, clears corrected duplicates, and ignores skipped or merely viewed questions',()=>{
  const bank=[question('a','Same question'),question('b','Same question!'),question('c','Still wrong'),question('d','Viewed'),question('e','Skipped only')];
  const rows=[record('a',false,'01'),record('b',true,'02'),record('c',false,'01'),record('c',null,'03'),{question_id:'d'},record('e',null,'04')];
  assert.deepEqual(retake.analyse(rows,bank,selection.key).pending.map(q=>q.id),['c']);
  rows.push(record('c',true,'05'));
  assert.equal(retake.analyse(rows,bank,selection.key).pending.length,0);
  rows.push(record('c',false,'06'));
  assert.equal(retake.analyse(rows,bank,selection.key).pending.length,1);
});

test('weak areas use question topics, count actual answers, and retain deleted-question statistics',()=>{
  const bank=[question('a','A','Nutrition'),question('b','B','Psychology')];
  const rows=[record('a',false,'01','Full Syllabus'),record('a',true,'02','Full Syllabus'),record('b',false,'01'),record('removed',false,'01','Legislation'),record('b',null,'02')];
  const result=retake.analyse(rows,bank,selection.key);
  assert.deepEqual(result.topics.find(t=>t.topic==='Nutrition'),{topic:'Nutrition',answered:2,wrong:1,pending:0,errorRate:50});
  assert.equal(result.topics.find(t=>t.topic==='Legislation').wrong,1);
  assert.deepEqual(result.pending.map(q=>q.id),['b']);
});

test('history pagination honors smaller server caps and rejects partial history on failure',async()=>{
  const rows=Array.from({length:1203},(_,i)=>i);
  const fetched=await retake.readPages(async offset=>rows.slice(offset,offset+97));
  assert.deepEqual(fetched,rows);
  await assert.rejects(retake.readPages(async offset=>{if(offset)throw new Error('offline');return [1,2];}),/offline/);
});

function app(){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:id==='wa-count'?'25':'all',style:{},classList:{add(){},remove(){}},querySelector:()=>({}),appendChild(){},setAttribute(){}});
    return elements.get(id);
  };
  const context=vm.createContext({QuestionSelection:selection,WrongAnswerRetake:retake,console,
    window:{addEventListener(){},scrollTo(){}},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({})},
    localStorage:{getItem(){return null},setItem(){},removeItem(){}},setInterval(){},clearInterval(){},setTimeout(){},alert(){},Date,Map,Set,
  });
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1],context);
  vm.runInContext(fs.readFileSync(require.resolve('../wrong-answer-ui.js'),'utf8'),context);
  vm.runInContext("currentUser={id:'student-1',username:'student'}; showScreen=()=>{}; buildPalette=()=>{}; renderQuizQuestion=()=>{};",context);
  return {context,element,run:code=>vm.runInContext(code,context)};
}

test('retake submission saves per-question results and correct answers leave the queue on the next load',async()=>{
  const a=app();let rows=[record('a',false,'01')];
  a.context.testBank=[question('a','A')];
  a.context.fetch=async url=>{
    const parsed=new URL(url);
    assert.equal(parsed.searchParams.get('user_id'),'eq.student-1');
    return {ok:true,json:async()=>parsed.pathname.endsWith('/question_history')&&!Number(parsed.searchParams.get('offset'))?rows:[]};
  };
  a.context.save=async(table,payload)=>{
    if(table==='quiz_attempts'){assert.match(payload.topic,/Wrong Answers Retake/);assert.equal(payload.mode,'practice');return [{id:'retake-attempt'}];}
    if(table==='question_history'){assert.equal(payload[0].attempt_id,'retake-attempt');rows.push(...payload);return true;}
  };
  a.run('allQuestions=testBank; sbPost=save; closeModal=()=>{}; showResults=()=>{};');
  await a.run('startWrongAnswersQuiz()');
  assert.equal(a.run('quizState.isWrongRetake'),true);
  assert.equal(a.run('quizState.questions.length'),1);
  a.run('quizState.answers[0]=0');
  await a.run('submitQuiz()');
  const data=await a.run('loadWrongAnswerData()');
  assert.equal(data.pending.length,0);
});

test('failed history and account changes cannot start a retake with partial or another user’s data',async()=>{
  const a=app();a.context.testBank=[question('a','A')];a.run('allQuestions=testBank');
  a.context.fetch=async()=>({ok:false});
  await a.run('startWrongAnswersQuiz()');
  assert.equal(a.run('quizState'),null);
  a.context.fetch=async()=>{a.run("currentUser={id:'student-2'}");return {ok:true,json:async()=>[]};};
  await assert.rejects(a.run('loadWrongAnswerData()'),/account changed/);
});
