const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const selection=require('../question-selection');
const bank=JSON.parse(fs.readFileSync(require.resolve('../questions.json'),'utf8'));
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const q=(id,text,topic='Topic')=>({id,q:text,s:topic,o:['A','B','C','D'],a:0,e:''});

function app(storage=new Map(),remoteStudyIds=new Set(),remoteQuizIds=new Set(),remoteReviewIds=new Set()){
  const alerts=[];
  const elements=new Map();
  const context=vm.createContext({
    QuestionSelection:selection,console:{error(){},warn(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    window:{addEventListener(){},scrollTo(){}},
    document:{querySelectorAll:()=>[],querySelector:s=>({value:s.includes('qcount')?'25':'practice'}),
      getElementById:id=>{
        if(!elements.has(id)){
          const child={};
          elements.set(id,{value:'all',style:{},checked:false,querySelector:()=>child,setAttribute(name,value){this[name]=value;}});
        }
        return elements.get(id);
      }},
    alert:msg=>alerts.push(msg),confirm:()=>false,
    fetch:async url=>{
      if(String(url).includes('/study_question_history?')){
        const parsed=new URL(String(url));
        const offset=Number(parsed.searchParams.get('offset')||0);
        const limit=Number(parsed.searchParams.get('limit')||500);
        const rows=[...remoteStudyIds].slice(offset,offset+limit).map(question_id=>({question_id}));
        return {ok:true,status:200,json:async()=>rows};
      }
      if(String(url).includes('/quiz_question_history?')){
        const parsed=new URL(String(url));
        const offset=Number(parsed.searchParams.get('offset')||0);
        const limit=Number(parsed.searchParams.get('limit')||500);
        const rows=[...remoteQuizIds].slice(offset,offset+limit).map(question_id=>({question_id}));
        return {ok:true,status:200,json:async()=>rows};
      }
      if(String(url).includes('/study_review_question_history?')){
        const parsed=new URL(String(url));
        const offset=Number(parsed.searchParams.get('offset')||0);
        const limit=Number(parsed.searchParams.get('limit')||500);
        const rows=[...remoteReviewIds].slice(offset,offset+limit).map(question_id=>({question_id}));
        return {ok:true,status:200,json:async()=>rows};
      }
      throw new Error('Unexpected network request');
    },
    clearInterval(){},setInterval(){return 1;},setTimeout(){},Date,Map,Set
  });
  vm.runInContext(script,context);
  context.testProgressUpsert=async(table,rows)=>{
    const target=table==='quiz_question_history'?remoteQuizIds:table==='study_review_question_history'?remoteReviewIds:remoteStudyIds;
    (Array.isArray(rows)?rows:[rows]).forEach(row=>target.add(row.question_id));
    return true;
  };
  vm.runInContext(`currentUser={id:'student-1',username:'student'};
    showScreen=()=>{};buildPalette=()=>{};
    sbPost=async()=>[{id:'session'}];
    sbUpsertIgnore=testProgressUpsert;
    const originalQuizRenderer=renderQuizQuestion;
    const originalStudyRenderer=renderStudyQuestion;
    renderStudyQuestion=()=>rememberQuestion('study',studyState.questions[studyState.currentIdx]);
    renderQuizQuestion=()=>rememberQuestion(quizState.isRevision?'viewed-quiz':'quiz',quizState.questions[quizState.currentIdx]);`,context);
  return {context,alerts,storage,run:code=>vm.runInContext(code,context),setBank:rows=>{context.testBank=rows;vm.runInContext('allQuestions=testBank',context);}};
}

test('quiz setup offers 200 and 300 question options',()=>{
  const counts=[...html.matchAll(/name="qcount" value="(\d+)"/g)].map(match=>Number(match[1]));
  assert.deepEqual(counts,[25,50,75,100,200,300,400,500]);
});

test('advanced questions load with their written choices and can be studied or quizzed separately',async()=>{
  const a=app();
  const scripts=[...html.matchAll(/<script src="((?:previous-year-|generated-pyq-|advanced-practice)[^"]+)"><\/script>/g)];
  for(const [,file] of scripts){
    a.run(fs.readFileSync(require.resolve(`../${file.split('?')[0]}`),'utf8'));
  }
  a.context.testBank=bank;
  a.run('fetchQuestionBank=async()=>({json:async()=>testBank});sbGet=async()=>[]');
  await a.run('loadQuestions()');

  const advanced=Array.from(a.run("allQuestions.filter(q=>q.s.startsWith(ADVANCED_TOPIC_PREFIX))"));
  assert.equal(advanced.length,160);
  const older=Array.from(a.run('allQuestions.filter(q=>!q.module).concat(window.PREVIOUS_YEAR_036_2022,window.PREVIOUS_YEAR_326_2022)'));
  assert.equal(new Set([...older,...advanced].map(q=>q.id)).size,older.length+advanced.length);
  const olderKeys=new Set(older.map(selection.key));
  assert.equal(new Set(advanced.map(selection.key)).size,160);
  for(const question of advanced){
    assert.ok(!olderKeys.has(selection.key(question)),question.id);
    const optionCount=Number(question.id.split('-').at(-1))<=15?6:4;
    assert.equal(question.o.length,optionCount,question.id);
    assert.equal(new Set(question.o).size,optionCount,question.id);
    assert.ok(Number.isInteger(question.a)&&question.a>=0&&question.a<optionCount,question.id);
    assert.ok(question.hint.length>0,question.id);
    assert.ok(question.e.length>0,question.id);
    if(question.source)assert.equal(new URL(question.source).protocol,'https:');
  }

  const moduleTopics=Array.from(a.run('Object.values(SYLLABUS_TOPIC_NAMES).flat()'));
  assert.equal(moduleTopics.length,21);
  let moduleQuestionTotal=0;
  for(const topic of moduleTopics){
    const rows=Array.from(a.run(`advancedModuleQuestions(${JSON.stringify(topic)})`));
    const base=bank.filter(q=>q.s===topic);
    moduleQuestionTotal+=rows.length;
    assert.equal(rows.length,400,topic);
    assert.equal(new Set(rows.map(q=>q.id)).size,400,topic);
    assert.equal(new Set(rows.map(selection.key)).size,400,topic);
    assert.ok(rows.every(q=>q.module===Number(topic.match(/Module (\d+)/)[1])),topic);
    assert.deepEqual(rows.filter(q=>!q.hint||!q.e).map(q=>q.id),[],topic);
    const curatedMinimum=400-Math.min(400,base.length);
    const applicationCount=rows.filter(q=>a.run(`isApplicationQuestion(allQuestions.find(item=>item.id===${JSON.stringify(q.id)}))`)).length;
    assert.ok(applicationCount>=curatedMinimum,topic);
  }
  assert.equal(moduleQuestionTotal,8400);
  const advancedGrid=a.context.document.getElementById('study-advanced-grid');
  const otherGrid=a.context.document.getElementById('study-topic-grid');
  assert.equal((advancedGrid.innerHTML.match(/2000 remaining/g)||[]).length,3);
  assert.match(advancedGrid.innerHTML,/2400 remaining/);
  assert.doesNotMatch(otherGrid.innerHTML,/Advanced Practice -/);
  a.run("showAdvancedModules('Sociology')");
  const moduleGrid=a.context.document.getElementById('study-advanced-module-grid');
  assert.equal((moduleGrid.innerHTML.match(/400 remaining · 400 total/g)||[]).length,5);

  a.run('renderStudyQuestion=originalStudyRenderer;sbPatch=async()=>true');
  const sociologyModule='Sociology - Module 1: Origin and Development of Sociology';
  await a.run(`startStudy(advancedStudyTopic(${JSON.stringify(sociologyModule)}))`);
  assert.equal(a.run('studyState.questions.length'),400);
  const studyHint=a.context.document.getElementById('study-hint');
  const studyExplanation=a.context.document.getElementById('study-explanation');
  assert.equal(studyHint.hidden,false);
  assert.ok(studyHint.querySelector('p').textContent.length>0);
  assert.equal(studyExplanation.style.display,'none');
  a.run('studyAnswer(studyState.questions[0].a)');
  assert.equal(studyHint.hidden,true);
  assert.equal(studyExplanation.style.display,'');
  assert.match(studyExplanation.innerHTML,/Explanation:.*CDPO syllabus/);
  a.run("setStudyView('viewed')");
  assert.match(moduleGrid.innerHTML,/1 viewed · 400 total/);

  const topicSelect=a.context.document.getElementById('qs-topic');
  assert.match(topicSelect.innerHTML,/<option value="advanced">Advanced Practice \(All Subjects\)<\/option>/);
  topicSelect.value='advanced';
  a.run('fetchUserHistory=async()=>({lastSeen:new Map(),lastCorrect:new Map()})');
  await a.run('startQuiz()');
  assert.equal(a.run('quizState.questions.length'),25);
  assert.ok(a.run('quizState.questions.every(q=>q.s.startsWith(ADVANCED_TOPIC_PREFIX))'));
});

test('advanced practice shows a hint and locks the first answer while timed quizzes hide feedback',()=>{
  const a=app();
  const item={...q('advanced','Sample question','Advanced Practice - Sociology'),module:1,
    hint:'Find the decisive clue.',e:'Reasoning here.',source:'https://example.com/reading'};
  a.setBank([item]);
  a.run(`renderQuizQuestion=originalQuizRenderer;
    quizState={questions:allQuestions,answers:[-1],currentIdx:0,mode:'practice',guided:true};
    renderQuizQuestion();`);
  const hint=a.context.document.getElementById('quiz-hint');
  const feedback=a.context.document.getElementById('quiz-feedback');
  assert.equal(hint.hidden,false);
  assert.equal(hint.querySelector('p').textContent,item.hint);
  assert.equal(feedback.hidden,true);
  a.run('selectAnswer(1);selectAnswer(0)');
  assert.equal(a.run('quizState.answers[0]'),1);
  assert.equal(hint.hidden,true);
  assert.equal(feedback.hidden,false);
  assert.match(feedback.innerHTML,/Correct answer: A.*Reasoning here.*https:\/\/example\.com\/reading/);
  a.run("quizState.mode='timed';quizState.guided=false;renderQuizQuestion();selectAnswer(0)");
  assert.equal(a.run('quizState.answers[0]'),0);
  assert.equal(hint.hidden,true);
  assert.equal(feedback.hidden,true);
  assert.equal(feedback.innerHTML,'');
});

test('deduplicated bank has unique wording and selection retains IDs',()=>{
  const unique=selection.unique(bank);
  assert.equal(unique.length,bank.length);
  assert.equal(new Set(unique.map(selection.key)).size,unique.length);
  assert.ok(unique.every(record=>bank.includes(record)));
  const remaining=selection.unseen(bank,bank,new Set([bank[0].id]));
  assert.ok(!remaining.some(record=>record.id===bank[0].id));
});

test('normalizes case, whitespace, Unicode quotes and punctuation; keeps different wording',()=>{
  const rows=[q('a','  What is “X”? '),q('b','WHAT--IS "X"'),q('c','What is Y?')];
  assert.deepEqual(selection.unique(rows).map(x=>x.id),['a','c']);
  assert.deepEqual(selection.viewed(rows,rows,new Set(['b'])).map(x=>x.id),['a']);
});

test('study resumes after reload and logout; another account has independent progress',async()=>{
  const storage=new Map();
  const rows=[q('a','First'),q('alias','FIRST'),q('b','Second'),q('c','Third')];
  const remoteStudyIds=new Set();
  const first=app(storage,remoteStudyIds);first.setBank(rows);
  await first.run("startStudy('Topic')");
  assert.deepEqual(Array.from(first.run('studyState.questions.map(q=>q.id)')),['a','b','c']);
  assert.equal(storage.has('cdpo_seen_study_student-1'),false);
  first.run('clearLoginSession()');
  const next=app(storage,remoteStudyIds);next.setBank(rows);
  await next.run("startStudy('Topic')");
  assert.deepEqual(Array.from(next.run('studyState.questions.map(q=>q.id)')),['b','c']);
  const otherAccount=app(storage);otherAccount.setBank(rows);
  otherAccount.run("currentUser={id:'student-2'}");
  await otherAccount.run("startStudy('Topic')");
  assert.equal(otherAccount.run('studyState.questions[0].id'),'a');
});

test('study progress syncs across browsers and prevents viewed questions from repeating',async()=>{
  const remote=new Set();
  const rows=[q('a','First'),q('b','Second')];
  const first=app(new Map(),remote);first.setBank(rows);
  await first.run('loadStudyProgress()');
  await first.run('persistStudyQuestion(testBank[0])');
  assert.deepEqual([...remote],['a']);

  const otherBrowser=app(new Map(),remote);otherBrowser.setBank(rows);
  await otherBrowser.run('loadStudyProgress()');
  await otherBrowser.run("startStudy('Topic')");
  assert.deepEqual(Array.from(otherBrowser.run('studyState.questions.map(q=>q.id)')),['b']);
});

test('study previous navigation stays in the session',async()=>{
  const a=app();a.setBank([q('a','First'),q('b','Second'),q('c','Third')]);
  await a.run("startStudy('Topic')");
  await a.run('studyNav(1)');
  assert.equal(a.run('studyState.currentIdx'),1);
  await a.run('studyNav(-1)');
  assert.equal(a.run('studyState.currentIdx'),0);
  await a.run('studyNav(-1)');
  assert.equal(a.run('studyState.currentIdx'),0);
});

test('existing local study progress is migrated to the server',async()=>{
  const storage=new Map([['cdpo_seen_study_student-1',JSON.stringify(['a','b'])]]);
  const remote=new Set(['a']);
  const a=app(storage,remote);a.setBank([q('a','First'),q('b','Second')]);
  assert.equal(await a.run('loadStudyProgress()'),true);
  assert.deepEqual([...remote].sort(),['a','b']);
});

test('study keeps completed questions out of Remaining and makes them available in Viewed',async()=>{
  const a=app();a.setBank([q('a','First')]);
  await a.run("startStudy('Topic')");
  a.run('studyState=null');
  await a.run("startStudy('Topic')");
  assert.equal(a.run('studyState'),null);
  assert.ok(a.alerts.at(-1).includes('Viewed tab'));
  await a.run("startStudy('Topic','viewed')");
  assert.equal(a.run('studyState.questions[0].id'),'a');
});

test('study topic tabs report remaining and viewed counts',async()=>{
  const a=app();a.setBank([q('a','First'),q('b','Second')]);
  await a.run("startStudy('Topic')");
  a.run("setStudyView('remaining')");
  assert.ok(a.run("document.getElementById('study-topic-grid').innerHTML").includes('1 remaining'));
  a.run("setStudyView('viewed')");
  assert.ok(a.run("document.getElementById('study-topic-grid').innerHTML").includes('1 viewed'));
});

test('Study Review only uses questions opened in Study Mode and does not repeat across browsers',async()=>{
  const storage=new Map([['cdpo_seen_study_student-1',JSON.stringify(['a'])]]);
  const a=app(storage);a.setBank([q('a','Viewed'),q('b','Viewed'),q('c','Not viewed'),q('d','Other','Other Topic')]);
  a.context.document.querySelector=s=>({value:s.includes('rcount')?'all':'practice'});
  await a.run('startRevision()');
  assert.deepEqual(Array.from(a.run('quizState.questions.map(q=>q.id)')),['a']);
  assert.ok(a.run('quizState.topic').includes('All Viewed Items'));
  assert.ok(a.run("seenProgress('viewed-quiz').has('a')"));
  const remoteReviewIds=new Set();
  const first=app(new Map([['cdpo_seen_study_student-1',JSON.stringify(['a'])]]),new Set(),new Set(),remoteReviewIds);
  first.setBank([q('a','Viewed'),q('b','Not viewed')]);
  first.context.document.querySelector=s=>({value:s.includes('rcount')?'all':'practice'});
  await first.run('startRevision()');
  assert.ok(remoteReviewIds.has('a'));
  const other=app(new Map(),new Set(['a']),new Set(),remoteReviewIds);other.setBank([q('a','Viewed'),q('b','Not viewed')]);
  other.context.document.querySelector=s=>({value:s.includes('rcount')?'all':'practice'});
  await other.run('startRevision()');
  assert.equal(other.run('quizState'),null);
  a.run('quizState=null');
  await a.run('startRevision()');
  assert.equal(a.run('quizState'),null);
  assert.ok(a.alerts.at(-1).includes('already used all viewed questions'));
});

test('quiz never repeats questions already used in Quiz Mode',async()=>{
  const a=app();a.setBank([q('a','Wrong'),q('alias','WRONG','Other'),q('b','New'),q('c','Correct'),q('d','Skipped')]);
  a.run("fetchUserHistory=async()=>({lastSeen:new Map([['a',1],['c',2],['d',3]]),lastCorrect:new Map([['a',false],['c',true],['d',null]])})");
  await a.run('startQuiz()');
  assert.deepEqual(Array.from(a.run('quizState.questions.map(q=>q.id).sort()')),['b']);
  assert.ok(a.alerts.some(message=>message.includes('Only 1 eligible questions remain')));
});

test('quiz eligibility excludes duplicate wording already seen in Quiz Mode',()=>{
  const rows=[q('a','Same'),q('alias','SAME','Other'),q('b','Other')];
  const lastSeen=new Map([['a',1],['alias',2],['b',3]]);
  const lastCorrect=new Map([['a',false],['alias',true],['b',false]]);
  assert.deepEqual(selection.quizEligible(rows,rows,lastSeen,lastCorrect,new Set(['a'])).map(x=>x.id),['b']);
  lastSeen.set('a',4);
  assert.deepEqual(selection.quizEligible(rows,rows,lastSeen,lastCorrect,new Set(['a'])).map(x=>x.id),['b']);
});

test('abandoned quiz visits sync across browsers but unviewed questions remain available',async()=>{
  const remoteQuizIds=new Set(),rows=[q('a','First'),q('b','Second'),q('c','Third')];
  const first=app(new Map(),new Set(),remoteQuizIds);first.setBank(rows);
  await first.run('loadQuizProgress()');
  first.run('fetchUserHistory=async()=>({lastSeen:new Map(),lastCorrect:new Map()})');
  await first.run('startQuiz()');
  const displayed=first.run('quizState.questions[0].id');
  assert.ok(remoteQuizIds.has(displayed));
  const next=app(new Map(),new Set(),remoteQuizIds);next.setBank(rows);
  await next.run('loadQuizProgress()');
  next.run('fetchUserHistory=async()=>({lastSeen:new Map(),lastCorrect:new Map()})');
  await next.run('startQuiz()');
  const ids=Array.from(next.run('quizState.questions.map(q=>q.id)'));
  assert.equal(ids.length,2);assert.ok(!ids.includes(displayed));
});

test('existing local quiz progress is migrated to the server',async()=>{
  const storage=new Map([['cdpo_seen_quiz_student-1',JSON.stringify(['a','b'])]]);
  const remoteQuizIds=new Set(['a']);
  const a=app(storage,new Set(),remoteQuizIds);a.setBank([q('a','First'),q('b','Second')]);
  assert.equal(await a.run('loadQuizProgress()'),true);
  assert.deepEqual([...remoteQuizIds].sort(),['a','b']);
});

test('quiz stops when every available question was answered correctly',async()=>{
  const a=app();a.setBank([q('a','First')]);
  a.run("fetchUserHistory=async()=>({lastSeen:new Map([['a',1]]),lastCorrect:new Map([['a',true]])})");
  await a.run('startQuiz()');
  assert.equal(a.run('quizState'),null);
  assert.ok(a.alerts[0].includes('Study Review'));
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
  a.run('quizProgressLoadedUsers.add(currentUser.id)');
  let calls=0;
  a.context.fetch=async()=>++calls===1?{ok:true,json:async()=>[{question_id:'old',answered_at:'2026-09-24',is_correct:false}]}:{ok:false};
  await a.run('startQuiz()');
  assert.equal(a.run('quizState'),null);
  assert.ok(a.alerts[0].includes('Could not load'));
  assert.equal(a.run('startingQuiz'),false);
});

test('repeated start clicks cannot create overlapping quizzes',async()=>{
  const a=app();a.setBank([q('a','First')]);
  a.run('quizProgressLoadedUsers.add(currentUser.id)');
  let release,calls=0;
  a.context.fetch=()=>{calls++;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>[]});});};
  const pending=a.run('startQuiz()');
  await a.run('startQuiz()');
  assert.equal(calls,1);release();await pending;
  assert.equal(a.run('startingQuiz'),false);
});
