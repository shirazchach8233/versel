const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const selection=require('../question-selection');
const bank=JSON.parse(fs.readFileSync(require.resolve('../questions.json'),'utf8'));
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const q=(id,text,topic='Topic')=>({id,q:text,s:topic,o:['A','B','C','D'],a:0,e:''});

function app(storage=new Map()){
  const alerts=[];
  const elements=new Map();
  const context=vm.createContext({
    QuestionSelection:selection,console:{error(){},warn(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    window:{addEventListener(){},scrollTo(){}},
    document:{querySelectorAll:()=>[],querySelector:s=>({value:s.includes('qcount')?'25':'practice'}),
      getElementById:id=>{if(!elements.has(id))elements.set(id,{value:'all',style:{},checked:false});return elements.get(id);}},
    alert:msg=>alerts.push(msg),confirm:()=>false,
    fetch:async()=>{throw new Error('Unexpected network request');},
    clearInterval(){},setInterval(){return 1;},setTimeout(){},Date,Map,Set
  });
  vm.runInContext(script,context);
  vm.runInContext(`currentUser={id:'student-1',username:'student'};
    showScreen=()=>{};buildPalette=()=>{};
    sbPost=async()=>[{id:'session'}];
    renderStudyQuestion=()=>rememberQuestion('study',studyState.questions[studyState.currentIdx]);
    renderQuizQuestion=()=>rememberQuestion('quiz',quizState.questions[quizState.currentIdx]);`,context);
  return {context,alerts,storage,run:code=>vm.runInContext(code,context),setBank:rows=>{context.testBank=rows;vm.runInContext('allQuestions=testBank',context);}};
}

test('real bank has cross-topic duplicates; selection retains IDs and excludes duplicate text',()=>{
  const unique=selection.unique(bank);
  assert.ok(unique.length<bank.length);
  assert.equal(new Set(unique.map(selection.key)).size,unique.length);
  assert.ok(unique.every(record=>bank.includes(record)));
  const keys=new Set();
  const duplicate=bank.find(record=>{const key=selection.key(record);if(keys.has(key))return true;keys.add(key);return false;});
  const remaining=selection.unseen(bank,bank,new Set([duplicate.id]));
  assert.ok(remaining.every(record=>selection.key(record)!==selection.key(duplicate)));
});

test('normalizes case, whitespace, Unicode quotes; keeps different question text',()=>{
  const rows=[q('a','  What is “X”? '),q('b','WHAT  IS "X"?'),q('c','What is Y?')];
  assert.deepEqual(selection.unique(rows).map(x=>x.id),['a','c']);
});

test('study resumes after reload and logout; another account has independent progress',async()=>{
  const storage=new Map();
  const rows=[q('a','First'),q('alias','FIRST'),q('b','Second'),q('c','Third')];
  const first=app(storage);first.setBank(rows);
  await first.run("startStudy('Topic')");
  assert.deepEqual(Array.from(first.run('studyState.questions.map(q=>q.id)')),['a','b','c']);
  first.run('clearLoginSession()');
  const next=app(storage);next.setBank(rows);
  await next.run("startStudy('Topic')");
  assert.deepEqual(Array.from(next.run('studyState.questions.map(q=>q.id)')),['b','c']);
  next.run("currentUser={id:'student-2'}");
  await next.run("startStudy('Topic')");
  assert.equal(next.run('studyState.questions[0].id'),'a');
});

test('study restarts only after explicit choice once a topic is exhausted',async()=>{
  const a=app();a.setBank([q('a','First')]);
  await a.run("startStudy('Topic')");
  a.run('studyState=null');
  await a.run("startStudy('Topic')");
  assert.equal(a.run('studyState'),null);
  a.context.confirm=()=>true;
  await a.run("startStudy('Topic')");
  assert.equal(a.run('studyState.questions[0].id'),'a');
});

test('quiz excludes past wrong answers and text aliases and never pads a short quiz with repeats',async()=>{
  const a=app();a.setBank([q('a','Old'),q('alias','OLD','Other'),q('b','New'),q('c','Newest')]);
  a.run("fetchUserHistory=async()=>({lastSeen:new Map([['a',1]]),lastCorrect:new Map([['a',false]])})");
  await a.run('startQuiz()');
  assert.deepEqual(Array.from(a.run('quizState.questions.map(q=>q.id).sort()')),['b','c']);
  assert.ok(a.alerts.some(message=>message.includes('2 unseen')));
});

test('abandoned quiz visits are remembered across reload but unviewed questions remain available',async()=>{
  const storage=new Map(),rows=[q('a','First'),q('b','Second'),q('c','Third')];
  const first=app(storage);first.setBank(rows);
  first.run('fetchUserHistory=async()=>({lastSeen:new Map(),lastCorrect:new Map()})');
  await first.run('startQuiz()');
  const displayed=first.run('quizState.questions[0].id');
  const next=app(storage);next.setBank(rows);
  next.run('fetchUserHistory=async()=>({lastSeen:new Map(),lastCorrect:new Map()})');
  await next.run('startQuiz()');
  const ids=Array.from(next.run('quizState.questions.map(q=>q.id)'));
  assert.equal(ids.length,2);assert.ok(!ids.includes(displayed));
});

test('exhausted quiz directs user to revision instead of silently repeating',async()=>{
  const a=app();a.setBank([q('a','First')]);
  a.run("fetchUserHistory=async()=>({lastSeen:new Map([['a',1]]),lastCorrect:new Map()})");
  await a.run('startQuiz()');
  assert.equal(a.run('quizState'),null);
  assert.ok(a.alerts[0].includes('Revision Test'));
});

test('history reads beyond 1000 rows and honors lower server caps',async()=>{
  const a=app(),offsets=[];
  const rows=Array.from({length:1201},(_,i)=>({question_id:`q${i}`,answered_at:'2026-09-24T00:00:00Z',is_correct:true}));
  a.context.fetch=async url=>{
    const offset=Number(new URL(url).searchParams.get('offset'));offsets.push(offset);
    return {ok:true,json:async()=>rows.slice(offset,offset+100)};
  };
  const history=await a.run('fetchUserHistory()');
  assert.equal(history.lastSeen.size,1201);
  assert.equal(offsets.at(-1),1201);
});

test('a failed later history page blocks the quiz instead of treating old questions as new',async()=>{
  const a=app();a.setBank([q('a','First')]);
  let calls=0;
  a.context.fetch=async()=>++calls===1?{ok:true,json:async()=>[{question_id:'old',answered_at:'2026-09-24',is_correct:false}]}:{ok:false};
  await a.run('startQuiz()');
  assert.equal(a.run('quizState'),null);
  assert.ok(a.alerts[0].includes('Could not load'));
  assert.equal(a.run('startingQuiz'),false);
});

test('repeated start clicks cannot create overlapping quizzes',async()=>{
  const a=app();a.setBank([q('a','First')]);
  let release,calls=0;
  a.context.fetch=()=>{calls++;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>[]});});};
  const pending=a.run('startQuiz()');
  await a.run('startQuiz()');
  assert.equal(calls,1);release();await pending;
  assert.equal(a.run('startingQuiz'),false);
});
